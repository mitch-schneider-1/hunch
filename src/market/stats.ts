// Aggregate bet statistics for the exec/admin view. Pure — no DB, no Slack.
//
// "Concentration" answers the question an exec actually cares about: is this
// 62% the broad team, or one person with a huge position? It's computed
// PER USER (a user who places several bets counts once, with their stakes
// summed), because a single person spreading 10 bets is still one voice.

import { Side } from "@prisma/client";

export interface BetStakeInput {
  side: Side;
  coinsCommitted: number;
  userId: string;
}

export interface BetSummary {
  distinctBettors: number;
  yesStake: number;
  noStake: number;
  totalStake: number;
  /** Largest single participant's share of total stake, 0–1. 0 when no bets. */
  topUserShare: number;
}

export function summarizeBets(bets: BetStakeInput[]): BetSummary {
  let yesStake = 0;
  let noStake = 0;
  const stakeByUser = new Map<string, number>();

  for (const b of bets) {
    if (b.side === "YES") yesStake += b.coinsCommitted;
    else noStake += b.coinsCommitted;
    stakeByUser.set(b.userId, (stakeByUser.get(b.userId) ?? 0) + b.coinsCommitted);
  }

  const totalStake = yesStake + noStake;
  const topUserStake =
    stakeByUser.size > 0 ? Math.max(...stakeByUser.values()) : 0;
  const topUserShare = totalStake > 0 ? topUserStake / totalStake : 0;

  return {
    distinctBettors: stakeByUser.size,
    yesStake,
    noStake,
    totalStake,
    topUserShare,
  };
}
