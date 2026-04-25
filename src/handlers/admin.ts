import type { App, RespondFn } from "@slack/bolt";
import { prisma } from "../db";
import { priceYes } from "../market/lmsr";
import { buildAdminDashboard, type AdminMarketRow } from "../slack/blocks";
import { ensureUser, getWorkspaceByTeamId, refreshAdminStatus } from "../slack/workspace";

const MAX_TREND_POINTS = 8;

export async function handleAdminCommand(
  app: App,
  body: { user_id: string; team_id: string; channel_id?: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspaceByTeamId(body.team_id);
  const user = await refreshAdminStatus(
    app.client,
    await ensureUser(app.client, workspace, body.user_id)
  );

  const markets = await prisma.market.findMany({
    where: {
      workspaceId: workspace.id,
      status: "OPEN",
      ...(user.isAdmin ? {} : { creatorUserId: user.id }),
    },
    include: {
      bets: { select: { side: true } },
      priceSnapshots: {
        select: { probability: true, recordedAt: true },
        orderBy: { recordedAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: AdminMarketRow[] = markets.map((m) => {
    const yesCount = m.bets.filter((b) => b.side === "YES").length;
    const noCount = m.bets.filter((b) => b.side === "NO").length;

    // Downsample snapshots to MAX_TREND_POINTS evenly spaced points so
    // the sparkline doesn't blow out for popular markets.
    const snaps = m.priceSnapshots.map((s) => s.probability);
    const trend = downsample(snaps, MAX_TREND_POINTS);

    return {
      id: m.id,
      question: m.question,
      deadline: m.deadline,
      yesCount,
      noCount,
      currentProbability: priceYes(m.qYes, m.qNo, m.b),
      trend,
    };
  });

  await respond({
    response_type: "ephemeral",
    text: "Admin view",
    blocks: buildAdminDashboard(rows),
  });
}

function downsample(arr: number[], k: number): number[] {
  if (arr.length <= k) return arr;
  const out: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const idx = Math.floor((i * (arr.length - 1)) / (k - 1));
    out.push(arr[idx]);
  }
  return out;
}
