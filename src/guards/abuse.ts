// Abuse caps for the public install. Strangers from Twitter will probe
// these limits — they're cheap insurance against runaway DB cost or
// griefers spamming a workspace. Caps are intentionally generous for
// real teams.

import { prisma } from "../db";

export const MAX_MARKETS_PER_WORKSPACE_PER_DAY = 50;
export const MAX_BETS_PER_USER_PER_MARKET = 10;
export const MAX_QUESTION_LENGTH = 280;
export const MAX_CRITERIA_LENGTH = 1000;
export const MAX_RATIONALE_LENGTH = 500;

export class AbuseLimitError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = "AbuseLimitError";
  }
}

export async function assertCanCreateMarket(workspaceId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.market.count({
    where: { workspaceId, createdAt: { gte: since } },
  });
  if (count >= MAX_MARKETS_PER_WORKSPACE_PER_DAY) {
    throw new AbuseLimitError(
      "question_block",
      `This workspace already created ${count} markets in the last 24 hours. Try again tomorrow.`
    );
  }
}

export async function assertCanBet(userId: string, marketId: string): Promise<void> {
  const count = await prisma.bet.count({
    where: { userId, marketId },
  });
  if (count >= MAX_BETS_PER_USER_PER_MARKET) {
    throw new AbuseLimitError(
      "coins_block",
      `You've already placed ${count} hunches on this question. That's the cap — wait for it to resolve.`
    );
  }
}

export function validateMarketTextLengths(question: string, criteria: string): {
  field: string;
  message: string;
} | null {
  if (question.length > MAX_QUESTION_LENGTH) {
    return {
      field: "question_block",
      message: `Keep the question under ${MAX_QUESTION_LENGTH} characters.`,
    };
  }
  if (criteria.length > MAX_CRITERIA_LENGTH) {
    return {
      field: "criteria_block",
      message: `Keep the resolution criteria under ${MAX_CRITERIA_LENGTH} characters.`,
    };
  }
  return null;
}
