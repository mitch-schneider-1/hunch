import type { App, RespondFn } from "@slack/bolt";
import { prisma } from "../db";
import { payoutForBet } from "../market/lmsr";
import { buildPortfolio } from "../slack/blocks";
import { ensureUser, getWorkspaceByTeamId } from "../slack/workspace";

export async function handleMe(
  app: App,
  body: { user_id: string; team_id: string; channel_id?: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspaceByTeamId(body.team_id);
  const user = await ensureUser(app.client, workspace, body.user_id);

  // Defense-in-depth: filter through the market relation so we only see
  // bets in this workspace, even if a user.id ever collided across tenants.
  const bets = await prisma.bet.findMany({
    where: {
      userId: user.id,
      market: { workspaceId: workspace.id },
    },
    include: { market: true },
    orderBy: { createdAt: "desc" },
  });

  const open: Array<{
    question: string;
    side: "YES" | "NO";
    coinsCommitted: number;
  }> = [];
  const resolved: Array<{
    question: string;
    side: "YES" | "NO";
    outcome: "YES" | "NO";
    pnl: number;
  }> = [];
  let allTimePnl = 0;

  for (const bet of bets) {
    if (bet.market.status === "RESOLVED" && bet.market.outcome) {
      const payout = payoutForBet(bet.side, bet.sharesReceived, bet.market.outcome);
      const pnl = Math.round(payout - bet.coinsCommitted);
      allTimePnl += pnl;
      resolved.push({
        question: bet.market.question,
        side: bet.side,
        outcome: bet.market.outcome,
        pnl,
      });
    } else if (bet.market.status === "OPEN") {
      open.push({
        question: bet.market.question,
        side: bet.side,
        coinsCommitted: bet.coinsCommitted,
      });
    }
    // VOIDED markets are silently dropped — the reset handler refunds those balances.
  }

  await respond({
    response_type: "ephemeral",
    blocks: buildPortfolio({
      coinBalance: user.coinBalance,
      openPositions: open,
      resolvedPositions: resolved,
      allTimePnl,
    }),
    text: "Your hunches",
  });
}
