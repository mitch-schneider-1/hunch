// Per-workspace user provisioning.
//
// Multi-tenant: workspace registration happens inside the OAuth install
// flow (see src/slack/install-store.ts). This file owns the user-side
// concerns: granting the 10K starting balance on first interaction, and
// keeping each user's admin flag in sync with Slack.

import type { WebClient } from "@slack/web-api";
import type { Prisma, User, Workspace } from "@prisma/client";
import { prisma } from "../db";

const STARTING_COINS = 10_000;

/**
 * Look up the workspace row for a given Slack team id. Throws if no
 * install exists for the team — which means an event is being processed
 * for a workspace we haven't been installed in. That should be impossible
 * under Bolt's OAuth model, but the throw is the safest failure mode.
 */
export async function getWorkspaceByTeamId(
  teamId: string | undefined
): Promise<Workspace> {
  if (!teamId) {
    throw new Error("Cannot resolve workspace: no team id in Slack context");
  }
  const ws = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });
  if (!ws) {
    throw new Error(`No workspace registered for team ${teamId}`);
  }
  return ws;
}

/**
 * Ensure a User row exists for this Slack user. If it's the first time
 * we've seen them in this workspace, grant the 10,000-coin starting balance.
 */
export async function ensureUser(
  client: WebClient,
  workspace: Workspace,
  slackUserId: string
): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: {
      workspaceId_slackUserId: {
        workspaceId: workspace.id,
        slackUserId,
      },
    },
  });
  if (existing) {
    return existing;
  }

  // Look up identity + admin status. Default gracefully if API fails.
  let username = slackUserId;
  let isAdmin = false;
  try {
    const info = await client.users.info({ user: slackUserId });
    username =
      info.user?.profile?.display_name ||
      info.user?.profile?.real_name ||
      info.user?.name ||
      slackUserId;
    isAdmin = Boolean(info.user?.is_admin || info.user?.is_owner);
  } catch {
    // ignore; we'll default to no-admin and the slack id as the name
  }

  return prisma.user.create({
    data: {
      workspaceId: workspace.id,
      slackUserId,
      username,
      isAdmin,
      coinBalance: STARTING_COINS,
    },
  });
}

/**
 * Refresh the user's `isAdmin` flag from Slack. Cheap to call; keeps
 * admin commands accurate even if someone is promoted/demoted.
 */
export async function refreshAdminStatus(
  client: WebClient,
  user: User
): Promise<User> {
  try {
    const info = await client.users.info({ user: user.slackUserId });
    const next = Boolean(info.user?.is_admin || info.user?.is_owner);
    if (next !== user.isAdmin) {
      return prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: next },
      });
    }
  } catch {
    // ignore
  }
  return user;
}

/**
 * Reset everyone's balance back to 10K and void all open markets.
 * Workspace-admin gated at the call site.
 */
export async function resetSeason(
  workspaceId: string
): Promise<{ usersReset: number; marketsVoided: number }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const usersReset = await tx.user.updateMany({
      where: { workspaceId },
      data: { coinBalance: STARTING_COINS },
    });
    const marketsVoided = await tx.market.updateMany({
      where: { workspaceId, status: "OPEN" },
      data: { status: "VOIDED", resolvedAt: new Date() },
    });
    return {
      usersReset: usersReset.count,
      marketsVoided: marketsVoided.count,
    };
  });
}

export const STARTING_COINS_AMOUNT = STARTING_COINS;
