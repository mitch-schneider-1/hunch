// Workspace provisioning + the user "first interaction" rule.
//
// On first startup we register the single workspace this single-tenant
// MVP serves and post a welcome message to #general. Subsequent runs
// no-op. On first interaction with any user, we grant them their 10K
// starting coins.

import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Prisma, Workspace, User } from "@prisma/client";
import { prisma } from "../db";

const STARTING_COINS = 10_000;

export async function provisionWorkspaceOnStartup(app: App): Promise<void> {
  const client = app.client;
  const auth = await client.auth.test();
  if (!auth.team_id || !auth.user_id) {
    throw new Error("auth.test did not return team_id/user_id");
  }
  const teamId = auth.team_id;
  const botUserId = auth.user_id;
  const teamName = (auth.team as string) || "Workspace";

  const memberCount = await countActiveMembers(client);

  const existing = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (existing) {
    // Refresh memberCount on every boot so admin views are accurate.
    await prisma.workspace.update({
      where: { id: existing.id },
      data: {
        memberCount,
        botUserId,
        botToken: process.env.SLACK_BOT_TOKEN || existing.botToken,
        name: teamName,
      },
    });
    return;
  }

  // New install — provision and welcome.
  await prisma.workspace.create({
    data: {
      slackTeamId: teamId,
      name: teamName,
      memberCount,
      botUserId,
      botToken: process.env.SLACK_BOT_TOKEN || "",
    },
  });

  await postWelcomeMessage(client);
}

async function countActiveMembers(client: WebClient): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  do {
    const res = await client.users.list({ limit: 200, cursor });
    if (res.members) {
      for (const m of res.members) {
        if (m.deleted) continue;
        if (m.is_bot) continue;
        if (m.id === "USLACKBOT") continue;
        count += 1;
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  } while (true);
  return Math.max(1, count);
}

async function postWelcomeMessage(client: WebClient): Promise<void> {
  // Find #general (or fallback to the first public channel) so we can post once.
  let cursor: string | undefined;
  let channelId: string | undefined;
  do {
    const res = await client.conversations.list({
      limit: 200,
      cursor,
      exclude_archived: true,
      types: "public_channel",
    });
    if (res.channels) {
      const general = res.channels.find((c: { is_general?: boolean; id?: string }) => c.is_general);
      if (general?.id) {
        channelId = general.id;
        break;
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  } while (true);

  if (!channelId) return; // no public channels — silent skip is fine for MVP

  await client.chat.postMessage({
    channel: channelId,
    text: "Hunch is here.",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Hunch is here.* It's a way to ask the team thoughtful, anonymous questions and see what people actually believe.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "Run `/hunch create` to ask a question. Run `/hunch me` to see your hunches and coin balance. Everyone starts with 10,000 coins — bet thoughtfully.",
        },
      },
    ],
  });
}

export async function getWorkspace(): Promise<Workspace> {
  const ws = await prisma.workspace.findFirst();
  if (!ws) {
    throw new Error(
      "No workspace registered. Restart the bot so it can provision the workspace."
    );
  }
  return ws;
}

/**
 * Ensure a User row exists for this Slack user. If it's the first time
 * we've seen them, grant the 10,000-coin starting balance.
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
export async function resetSeason(workspaceId: string): Promise<{ usersReset: number; marketsVoided: number }> {
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
