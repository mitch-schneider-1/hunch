import type { RespondFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { prisma } from "../db";
import { buildLeaderboard } from "../slack/blocks";
import { getWorkspaceByTeamId } from "../slack/workspace";

export async function handleLeaderboard(
  _client: WebClient,
  body: { user_id: string; team_id: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspaceByTeamId(body.team_id);

  // Score = liquid balance + sum of open commitments at cost.
  // This equals (starting coins + resolved-market P&L) — anonymizes positions
  // because committed coins are valued at cost, never at market price.
  const users = await prisma.user.findMany({
    where: { workspaceId: workspace.id },
    select: {
      slackUserId: true,
      coinBalance: true,
      bets: {
        where: { market: { status: "OPEN" } },
        select: { coinsCommitted: true },
      },
    },
  });

  const scored = users
    .map((u) => ({
      slackUserId: u.slackUserId,
      score:
        u.coinBalance +
        u.bets.reduce((sum, b) => sum + b.coinsCommitted, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((u, i) => ({ rank: i + 1, slackUserId: u.slackUserId, score: u.score }));

  await respond({
    response_type: "ephemeral",
    text: "Leaderboard",
    blocks: buildLeaderboard(scored),
  });
}
