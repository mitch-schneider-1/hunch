// Install-time welcome experience: DM the installer with a quickstart,
// post an announcement to the workspace's #general so teammates discover
// the bot. Both are best-effort — failures here log and continue. The
// install must succeed even if Slack postMessage fails.

import type { WebClient } from "@slack/web-api";
import { buildChannelAnnouncement, buildWelcomeDm } from "./blocks";

export async function sendInstallerWelcome(
  client: WebClient,
  installerSlackUserId: string | undefined
): Promise<void> {
  if (!installerSlackUserId) return;
  try {
    await client.chat.postMessage({
      channel: installerSlackUserId,
      text: "Welcome to Hunch.",
      blocks: buildWelcomeDm(installerSlackUserId),
    });
  } catch (err) {
    console.error("sendInstallerWelcome failed", err);
  }
}

export async function postChannelAnnouncement(
  client: WebClient,
  installerSlackUserId: string | undefined
): Promise<void> {
  try {
    const channelId = await findGeneralChannel(client);
    if (!channelId) return;
    await client.chat.postMessage({
      channel: channelId,
      text: "Hunch is here.",
      blocks: buildChannelAnnouncement(installerSlackUserId),
    });
  } catch (err) {
    console.error("postChannelAnnouncement failed", err);
  }
}

async function findGeneralChannel(client: WebClient): Promise<string | undefined> {
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      limit: 200,
      cursor,
      exclude_archived: true,
      types: "public_channel",
    });
    if (res.channels) {
      const general = res.channels.find(
        (c: { is_general?: boolean; id?: string }) => c.is_general
      );
      if (general?.id) return general.id;
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  } while (true);
  return undefined;
}
