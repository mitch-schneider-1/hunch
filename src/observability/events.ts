// Lightweight usage analytics. Best-effort by design — analytics
// failures must never abort a user-facing action. Every call is wrapped
// in try/catch and swallows errors.

import { prisma } from "../db";

export type EventType =
  | "install_completed"
  | "uninstall"
  | "command_used"
  | "market_created"
  | "bet_placed"
  | "market_resolved"
  | "market_voided"
  | "reset";

export interface LogEventOptions {
  userId?: string;
  marketId?: string;
  metadata?: Record<string, unknown>;
}

export async function logEvent(
  workspaceId: string,
  eventType: EventType,
  opts: LogEventOptions = {}
): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        workspaceId,
        eventType,
        userId: opts.userId,
        marketId: opts.marketId,
        ...(opts.metadata ? { metadata: opts.metadata as object } : {}),
      },
    });
  } catch (err) {
    // Analytics must never break the product.
    console.error("logEvent failed", { workspaceId, eventType, err });
  }
}
