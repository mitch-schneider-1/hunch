import type { App } from "@slack/bolt";
import { Side } from "@prisma/client";
import { prisma } from "../db";
import { applyBet, previewBet, SHARE_PAYOUT } from "../market/lmsr";
import {
  buildBetConfirmation,
  buildBetModal,
  buildMarketCard,
} from "../slack/blocks";
import { ensureUser, getWorkspace } from "../slack/workspace";

export function registerBet(app: App): void {
  // Click "Place a hunch" → open the bet modal.
  app.action({ action_id: "open_bet_modal" }, async ({ ack, body, client, action }) => {
    await ack();
    if (body.type !== "block_actions") return;
    if (action.type !== "button") return;

    const marketId = (action as { value: string }).value;
    const workspace = await getWorkspace();
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market || market.workspaceId !== workspace.id) {
      await client.chat.postEphemeral({
        channel: body.channel?.id ?? body.user.id,
        user: body.user.id,
        text: "I couldn't find that hunch.",
      });
      return;
    }
    if (market.status !== "OPEN") {
      await client.chat.postEphemeral({
        channel: body.channel?.id ?? body.user.id,
        user: body.user.id,
        text: "This hunch is closed.",
      });
      return;
    }
    if (market.deadline.getTime() < Date.now()) {
      await client.chat.postEphemeral({
        channel: body.channel?.id ?? body.user.id,
        user: body.user.id,
        text: "This hunch has passed its deadline. Awaiting resolution.",
      });
      return;
    }

    const user = await ensureUser(client, workspace, body.user.id);
    const defaultCoins = Math.min(100, user.coinBalance);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildBetModal({
        marketId: market.id,
        question: market.question,
        defaultCoins,
        maxCoins: user.coinBalance,
        // Modal opens with no side selected; user must choose before preview shows.
        preview: { state: "incomplete" },
      }),
    });
  });

  // Live preview: re-render the modal whenever side or coin amount changes.
  // This is what makes the "if right you win X / lose Y" stay accurate.
  // NOTE: the rerender is participant-facing and goes through the same
  // buildBetModal builder — which by construction never includes price.
  app.action(
    { action_id: /^(side_input|coins_input)$/ },
    async ({ ack, body, client }) => {
      await ack();
      if (body.type !== "block_actions" || !body.view) return;

      const marketId = body.view.private_metadata;
      const workspace = await getWorkspace();
      const market = await prisma.market.findUnique({ where: { id: marketId } });
      if (!market || market.workspaceId !== workspace.id) return;

      const user = await ensureUser(client, workspace, body.user.id);

      const draftValues = body.view.state.values;
      const sideRaw = draftValues.side_block?.side_input?.selected_option?.value;
      const coinsRaw = draftValues.coins_block?.coins_input?.value?.trim() ?? "";

      const args = {
        marketId,
        question: market.question,
        defaultCoins: Math.min(100, user.coinBalance),
        maxCoins: user.coinBalance,
        selectedSide: sideRaw === "YES" || sideRaw === "NO" ? (sideRaw as Side) : undefined,
        draftCoins: coinsRaw,
        preview: computePreview(market, sideRaw, coinsRaw, user.coinBalance),
      };

      await client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: buildBetModal(args),
      });
    }
  );

  // Modal submit → atomic ledger update + market state update + card refresh.
  app.view("submit_bet", async ({ ack, view, body, client }) => {
    const marketId = view.private_metadata;
    const sideRaw =
      view.state.values.side_block?.side_input?.selected_option?.value;
    const coinsRaw =
      view.state.values.coins_block?.coins_input?.value?.trim();

    const errors: Record<string, string> = {};
    if (sideRaw !== "YES" && sideRaw !== "NO") {
      errors.side_block = "Pick YES or NO.";
    }
    const coins = Number(coinsRaw);
    if (!coinsRaw || !Number.isFinite(coins) || coins <= 0 || !Number.isInteger(coins)) {
      errors.coins_block = "Enter a positive whole number of coins.";
    }
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    const side = sideRaw as Side;
    const workspace = await getWorkspace();

    // Pull state inside the transaction so concurrent bets don't race.
    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: {
            workspaceId_slackUserId: {
              workspaceId: workspace.id,
              slackUserId: body.user.id,
            },
          },
        });
        if (!user) throw new BetError("coins_block", "Restart Slack and try again.");
        if (coins > user.coinBalance) {
          throw new BetError(
            "coins_block",
            `You only have ${user.coinBalance.toLocaleString()} coins.`
          );
        }
        const market = await tx.market.findUnique({ where: { id: marketId } });
        if (!market) throw new BetError("coins_block", "This hunch no longer exists.");
        if (market.status !== "OPEN") {
          throw new BetError("coins_block", "This hunch is closed.");
        }
        if (market.deadline.getTime() < Date.now()) {
          throw new BetError("coins_block", "This hunch has passed its deadline.");
        }

        const updated = applyBet(market.qYes, market.qNo, market.b, side, coins);

        await tx.market.update({
          where: { id: market.id },
          data: { qYes: updated.qYes, qNo: updated.qNo },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { coinBalance: { decrement: coins } },
        });
        await tx.bet.create({
          data: {
            marketId: market.id,
            userId: user.id,
            side,
            coinsCommitted: coins,
            sharesReceived: updated.shares,
            priceAtBet: updated.priceAfter,
          },
        });
        await tx.priceSnapshot.create({
          data: {
            marketId: market.id,
            probability: updated.priceAfter,
          },
        });

        const participantCount = await tx.bet.count({
          where: { marketId: market.id },
        });

        return {
          market,
          shares: updated.shares,
          participantCount,
        };
      });

      await ack();

      // Compute participant-facing win/lose amounts (not internal price).
      const grossPayout = result.shares * SHARE_PAYOUT;
      const potentialWin = Math.max(0, grossPayout - coins);

      // Send ephemeral confirmation in the market's channel so the user
      // sees it where they took the action.
      await client.chat.postEphemeral({
        channel: result.market.channelId,
        user: body.user.id,
        text: "Your hunch is recorded.",
        blocks: buildBetConfirmation({
          side,
          coins,
          potentialWin,
          potentialLoss: coins,
          deadline: result.market.deadline,
        }),
      });

      // Refresh the market card with the new participant count.
      // Builder is the same one tests assert never leaks the price.
      if (result.market.messageTs) {
        const fresh = await prisma.market.findUnique({
          where: { id: result.market.id },
          include: { creator: true },
        });
        if (fresh) {
          await client.chat.update({
            channel: fresh.channelId,
            ts: fresh.messageTs!,
            text: `Hunch: ${fresh.question}`,
            blocks: buildMarketCard({
              id: fresh.id,
              creatorSlackUserId: fresh.creator.slackUserId,
              question: fresh.question,
              resolutionCriteria: fresh.resolutionCriteria,
              deadline: fresh.deadline,
              participantCount: result.participantCount,
              status: fresh.status,
            }),
          });
        }
      }
    } catch (err) {
      if (err instanceof BetError) {
        await ack({ response_action: "errors", errors: { [err.field]: err.message } });
        return;
      }
      await ack({
        response_action: "errors",
        errors: { coins_block: "Something went wrong. Try again." },
      });
      console.error("bet failed", err);
    }
  });
}

class BetError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

function computePreview(
  market: { qYes: number; qNo: number; b: number },
  sideRaw: string | undefined,
  coinsRaw: string,
  balance: number
): import("../slack/blocks").BetModalArgs["preview"] {
  if (sideRaw !== "YES" && sideRaw !== "NO") {
    return { state: "incomplete", message: "Pick YES or NO to see what's at stake." };
  }
  if (!coinsRaw) {
    return { state: "incomplete", message: "Enter the coins you want to commit." };
  }
  const coins = Number(coinsRaw);
  if (!Number.isFinite(coins) || coins <= 0 || !Number.isInteger(coins)) {
    return { state: "invalid", message: "Enter a positive whole number of coins." };
  }
  if (coins > balance) {
    return {
      state: "invalid",
      message: `You only have ${balance.toLocaleString()} coins.`,
    };
  }
  const p = previewBet(market.qYes, market.qNo, market.b, sideRaw, coins);
  return {
    state: "ready",
    potentialWin: p.potentialWin,
    potentialLoss: p.potentialLoss,
  };
}
