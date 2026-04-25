import type { App } from "@slack/bolt";
import { prisma } from "../db";
import { liquidityForWorkspace } from "../market/lmsr";
import {
  buildCreateMarketModal,
  buildMarketCard,
  CREATE_MARKET_TEMPLATES,
} from "../slack/blocks";
import { ensureUser, getWorkspaceByTeamId } from "../slack/workspace";
import {
  AbuseLimitError,
  assertCanCreateMarket,
  validateMarketTextLengths,
} from "../guards/abuse";
import { logEvent } from "../observability/events";

export function registerCreateMarket(app: App): void {
  // Open the create-market modal.
  app.action({ action_id: "open_create_market_modal" }, async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateMarketModal(),
    });
  });

  // Welcome DM "Ask anything" → opens a blank create modal.
  app.action({ action_id: "welcome_create_blank" }, async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateMarketModal(),
    });
  });

  // Welcome DM sample-market quick-creates → open the modal pre-filled.
  app.action(/^welcome_prefill_/, async ({ ack, body, client, action }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    if (action.type !== "button") return;
    const templateKey = (action as { value: string }).value;
    const template = CREATE_MARKET_TEMPLATES[templateKey] ?? {};
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildCreateMarketModal(template),
    });
  });

  // Modal submission → create market record + post Block Kit card to the chosen channel.
  app.view("submit_create_market", async ({ ack, view, body, client }) => {
    const values = view.state.values;
    const question = values.question_block?.question_input?.value?.trim();
    const criteria = values.criteria_block?.criteria_input?.value?.trim();
    const deadlineStr = values.deadline_block?.deadline_input?.selected_date;
    const channelId = values.channel_block?.channel_input?.selected_conversation;

    const errors: Record<string, string> = {};
    if (!question) errors.question_block = "Add a question.";
    if (!criteria) errors.criteria_block = "Tell people how this resolves.";
    if (!deadlineStr) errors.deadline_block = "Pick a deadline.";
    if (!channelId) errors.channel_block = "Pick a channel.";
    if (deadlineStr) {
      const d = new Date(`${deadlineStr}T23:59:59Z`);
      if (d.getTime() < Date.now()) {
        errors.deadline_block = "Deadline must be in the future.";
      }
    }
    if (question && criteria) {
      const lengthErr = validateMarketTextLengths(question, criteria);
      if (lengthErr) errors[lengthErr.field] = lengthErr.message;
    }
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    const deadline = new Date(`${deadlineStr}T23:59:59Z`);
    const workspace = await getWorkspaceByTeamId(body.team?.id);

    try {
      await assertCanCreateMarket(workspace.id);
    } catch (err) {
      if (err instanceof AbuseLimitError) {
        await ack({
          response_action: "errors",
          errors: { [err.field]: err.message },
        });
        return;
      }
      throw err;
    }

    await ack();

    const creator = await ensureUser(client, workspace, body.user.id);

    const b = liquidityForWorkspace(workspace.memberCount);

    const market = await prisma.market.create({
      data: {
        workspaceId: workspace.id,
        creatorUserId: creator.id,
        question: question!,
        resolutionCriteria: criteria!,
        deadline,
        channelId: channelId!,
        b,
      },
    });

    await logEvent(workspace.id, "market_created", {
      userId: creator.slackUserId,
      marketId: market.id,
      metadata: { questionLength: question!.length, criteriaLength: criteria!.length },
    });

    // Post the participant-facing card. Note: this builder is asserted
    // by tests to never include the market price.
    const blocks = buildMarketCard({
      id: market.id,
      creatorSlackUserId: creator.slackUserId,
      question: market.question,
      resolutionCriteria: market.resolutionCriteria,
      deadline: market.deadline,
      participantCount: 0,
      status: "OPEN",
    });

    let posted: { ts?: string };
    try {
      posted = await client.chat.postMessage({
        channel: channelId!,
        text: `New hunch: ${question}`,
        blocks,
      });
    } catch (err) {
      // If the bot isn't in the channel, surface a useful error.
      await client.chat.postEphemeral({
        channel: body.user.id,
        user: body.user.id,
        text: `I couldn't post to that channel. Add me to it first, then run \`/hunch create\` again. (Error: ${(err as Error).message})`,
      });
      await prisma.market.delete({ where: { id: market.id } });
      return;
    }

    if (posted.ts) {
      await prisma.market.update({
        where: { id: market.id },
        data: { messageTs: posted.ts },
      });
    }

    // Confirm to the creator privately.
    await client.chat.postEphemeral({
      channel: channelId!,
      user: body.user.id,
      text:
        "Posted. Your team can now place hunches. You'll see the aggregated signal with `/hunch admin`.",
    });
  });
}
