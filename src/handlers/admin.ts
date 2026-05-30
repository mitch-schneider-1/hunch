import type { RespondFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { Side } from "@prisma/client";
import { prisma } from "../db";
import { priceYes } from "../market/lmsr";
import { summarizeBets } from "../market/stats";
import { buildAdminDashboard, type AdminMarketRow } from "../slack/blocks";
import { ensureUser, getWorkspaceByTeamId, refreshAdminStatus } from "../slack/workspace";

const MAX_TREND_POINTS = 8;
const MAX_RATIONALES_SHOWN = 8;

export async function handleAdminCommand(
  client: WebClient,
  body: { user_id: string; team_id: string; channel_id?: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspaceByTeamId(body.team_id);
  const user = await refreshAdminStatus(
    client,
    await ensureUser(client, workspace, body.user_id)
  );

  const markets = await prisma.market.findMany({
    where: {
      workspaceId: workspace.id,
      status: "OPEN",
      ...(user.isAdmin ? {} : { creatorUserId: user.id }),
    },
    include: {
      // Need stakes (concentration), userId (distinct bettors), and rationale.
      bets: { select: { side: true, coinsCommitted: true, userId: true, rationale: true } },
      priceSnapshots: {
        select: { probability: true, recordedAt: true },
        orderBy: { recordedAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: AdminMarketRow[] = markets.map((m) => {
    const { distinctBettors, yesStake, noStake, topUserShare } = summarizeBets(
      m.bets
    );

    // Shuffle so the order of rationales doesn't correlate with bet timing
    // (which would otherwise be a weak de-anonymization channel).
    const rationales = shuffle(
      m.bets
        .filter((b): b is typeof b & { rationale: string } => Boolean(b.rationale))
        .map((b) => ({ side: b.side as Side, text: b.rationale }))
    ).slice(0, MAX_RATIONALES_SHOWN);

    const trend = downsample(
      m.priceSnapshots.map((s) => s.probability),
      MAX_TREND_POINTS
    );

    return {
      id: m.id,
      question: m.question,
      deadline: m.deadline,
      distinctBettors,
      currentProbability: priceYes(m.qYes, m.qNo, m.b),
      trend,
      yesStake,
      noStake,
      topUserShare,
      creatorPrior: m.creatorPrior,
      rationales,
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

// Fisher-Yates. Used only to decorrelate rationale order from bet order.
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
