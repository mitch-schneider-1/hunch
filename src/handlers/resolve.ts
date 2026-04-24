import type { App, RespondFn } from "@slack/bolt";
import { Side } from "@prisma/client";
import { prisma } from "../db";
import { payoutForBet, priceYes } from "../market/lmsr";
import { buildResolutionCard } from "../slack/blocks";
import { ensureUser, getWorkspace, refreshAdminStatus } from "../slack/workspace";

export function registerResolve(app: App): void {
  // Buttons rendered by the resolve picker (see handleResolveCommand).
  app.action({ action_id: /^resolve_(yes|no)$/ }, async ({ ack, body, action, client, respond }) => {
    await ack();
    if (action.type !== "button") return;
    const value = (action as { value: string }).value;
    const [marketId, sideRaw] = value.split("|");
    if (!marketId || (sideRaw !== "YES" && sideRaw !== "NO")) return;
    const userId = body.user.id;
    await doResolve(app, marketId, sideRaw as Side, userId, async (text) => {
      // Replace the picker with a confirmation in the same ephemeral surface.
      await respond({ response_type: "ephemeral", replace_original: true, text });
    });
  });
}

export async function handleResolveCommand(
  app: App,
  body: { user_id: string; channel_id?: string; text: string },
  respond: RespondFn
): Promise<void> {
  const args = body.text.trim().split(/\s+/).filter(Boolean);
  // First token is the subcommand "resolve" — strip it.
  args.shift();

  const workspace = await getWorkspace();
  const requester = await refreshAdminStatus(
    app.client,
    await ensureUser(app.client, workspace, body.user_id)
  );

  // Typed form: /hunch resolve <marketId> <yes|no>
  if (args.length === 2) {
    const [marketId, sideRaw] = args;
    const side = sideRaw.toUpperCase();
    if (side !== "YES" && side !== "NO") {
      await respond({ response_type: "ephemeral", text: "Use `yes` or `no` for the outcome." });
      return;
    }
    await doResolve(app, marketId, side as Side, body.user_id, async (text) => {
      await respond({ response_type: "ephemeral", text });
    });
    return;
  }

  // No args → show pickable list of markets the user is allowed to resolve.
  const markets = await prisma.market.findMany({
    where: {
      workspaceId: workspace.id,
      status: "OPEN",
      ...(requester.isAdmin ? {} : { creatorUserId: requester.id }),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (markets.length === 0) {
    await respond({
      response_type: "ephemeral",
      text: requester.isAdmin
        ? "No open markets to resolve."
        : "You can only resolve markets you created, and you don't have any open ones.",
    });
    return;
  }

  const blocks = markets.flatMap((m) => [
    {
      type: "section" as const,
      text: { type: "mrkdwn" as const, text: `*${m.question}*` },
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          style: "primary" as const,
          text: { type: "plain_text" as const, text: "Resolved YES", emoji: false },
          action_id: "resolve_yes",
          value: `${m.id}|YES`,
        },
        {
          type: "button" as const,
          style: "danger" as const,
          text: { type: "plain_text" as const, text: "Resolved NO", emoji: false },
          action_id: "resolve_no",
          value: `${m.id}|NO`,
        },
      ],
    },
    { type: "divider" as const },
  ]);

  await respond({
    response_type: "ephemeral",
    text: "Pick a market to resolve",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Resolve a market.* Only the creator and workspace admins see this list.",
        },
      },
      { type: "divider" },
      ...blocks,
    ],
  });
}

async function doResolve(
  app: App,
  marketId: string,
  outcome: Side,
  resolverSlackUserId: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const workspace = await getWorkspace();
  const resolver = await refreshAdminStatus(
    app.client,
    await ensureUser(app.client, workspace, resolverSlackUserId)
  );

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { creator: true, bets: true },
  });
  if (!market || market.workspaceId !== workspace.id) {
    await reply("I can't find that market.");
    return;
  }
  if (market.status !== "OPEN") {
    await reply("That market is already closed.");
    return;
  }
  if (!resolver.isAdmin && market.creatorUserId !== resolver.id) {
    await reply("Only the market creator or a workspace admin can resolve this.");
    return;
  }

  const finalProbability = priceYes(market.qYes, market.qNo, market.b);
  const participantCount = market.bets.length;

  // Pay out winners and close out the market in one transaction.
  await prisma.$transaction(async (tx) => {
    for (const bet of market.bets) {
      const payout = payoutForBet(bet.side, bet.sharesReceived, outcome);
      if (payout > 0) {
        await tx.user.update({
          where: { id: bet.userId },
          data: { coinBalance: { increment: Math.round(payout) } },
        });
      }
    }
    await tx.market.update({
      where: { id: market.id },
      data: {
        status: "RESOLVED",
        outcome,
        resolvedAt: new Date(),
      },
    });
  });

  // Post the public resolution card in the original channel.
  await app.client.chat.postMessage({
    channel: market.channelId,
    text: `Resolved: ${outcome}`,
    blocks: buildResolutionCard({
      question: market.question,
      outcome,
      finalProbability,
      participantCount,
    }),
    thread_ts: market.messageTs ?? undefined,
    reply_broadcast: Boolean(market.messageTs),
  });

  await reply(`Resolved *${market.question}* as *${outcome}*.`);
}
