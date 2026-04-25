// Bolt InstallationStore backed by Postgres via Prisma.
//
// Multi-tenant: every install creates or updates a Workspace row. The
// full Installation blob is stored verbatim in `installationJson` so
// Bolt's OAuth flow can round-trip it without our schema needing to
// track every field Slack adds in future API versions.
//
// On install we also fire the welcome flow (DM the installer + announce
// in #general). Welcome failures must not abort the install.

import type {
  Installation,
  InstallationQuery,
  InstallationStore,
} from "@slack/bolt";
import type { Prisma } from "@prisma/client";
import { WebClient } from "@slack/web-api";
import { prisma } from "../db";
import { logEvent } from "../observability/events";
import { postChannelAnnouncement, sendInstallerWelcome } from "./onboarding";

export const installationStore: InstallationStore = {
  async storeInstallation(installation) {
    const teamId = resolveInstallationTeamId(installation);
    if (!teamId) {
      throw new Error("storeInstallation: installation has no team or enterprise id");
    }

    const teamName =
      installation.team?.name ??
      installation.enterprise?.name ??
      "Workspace";
    const botUserId = installation.bot?.userId;
    const botToken = installation.bot?.token;
    if (!botUserId || !botToken) {
      throw new Error("storeInstallation: install is missing bot credentials");
    }

    const enterpriseId = installation.enterprise?.id ?? null;
    const installerSlackUserId = installation.user?.id;

    const memberCount = await safeCountMembers(botToken);

    const ws = await prisma.workspace.upsert({
      where: { slackTeamId: teamId },
      create: {
        slackTeamId: teamId,
        enterpriseId,
        name: teamName,
        memberCount,
        botUserId,
        botToken,
        installationJson: toJson(installation),
      },
      update: {
        name: teamName,
        memberCount,
        botUserId,
        botToken,
        enterpriseId,
        installationJson: toJson(installation),
      },
    });

    // Welcome flow. Best-effort — install must succeed even if Slack
    // postMessage fails (e.g. installer hasn't accepted DMs).
    const client = new WebClient(botToken);
    await sendInstallerWelcome(client, installerSlackUserId);
    await postChannelAnnouncement(client, installerSlackUserId);

    await logEvent(ws.id, "install_completed", {
      userId: installerSlackUserId,
      metadata: { teamName, memberCount, enterpriseId },
    });
  },

  async fetchInstallation(query) {
    const teamId = resolveQueryTeamId(query);
    if (!teamId) {
      throw new Error("fetchInstallation: query has no team or enterprise id");
    }

    const ws = await prisma.workspace.findUnique({
      where: { slackTeamId: teamId },
    });
    if (!ws) {
      throw new Error(`fetchInstallation: no workspace registered for ${teamId}`);
    }

    return ws.installationJson as unknown as Installation;
  },

  async deleteInstallation(query) {
    const teamId = resolveQueryTeamId(query);
    if (!teamId) return;

    const ws = await prisma.workspace.findUnique({
      where: { slackTeamId: teamId },
    });
    if (!ws) return;

    await logEvent(ws.id, "uninstall");
    await prisma.workspace.delete({ where: { id: ws.id } });
  },
};

function resolveInstallationTeamId(
  installation: Installation
): string | undefined {
  if (installation.team?.id) return installation.team.id;
  if (installation.isEnterpriseInstall && installation.enterprise?.id) {
    return installation.enterprise.id;
  }
  return undefined;
}

function resolveQueryTeamId(
  query: InstallationQuery<boolean>
): string | undefined {
  if (query.teamId) return query.teamId;
  if (query.isEnterpriseInstall && query.enterpriseId) return query.enterpriseId;
  return undefined;
}

function toJson(installation: Installation): Prisma.InputJsonValue {
  // Round-trip through JSON to drop any non-serializable values and
  // produce a structure Prisma's JSON type accepts cleanly.
  return JSON.parse(JSON.stringify(installation)) as Prisma.InputJsonValue;
}

async function safeCountMembers(botToken: string): Promise<number> {
  try {
    const client = new WebClient(botToken);
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
  } catch (err) {
    console.error("safeCountMembers failed; defaulting memberCount=1", err);
    return 1;
  }
}
