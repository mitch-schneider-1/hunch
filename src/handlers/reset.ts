import type { RespondFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  ensureUser,
  getWorkspaceByTeamId,
  refreshAdminStatus,
  resetSeason,
  STARTING_COINS_AMOUNT,
} from "../slack/workspace";
import { logEvent } from "../observability/events";

export async function handleResetCommand(
  client: WebClient,
  body: { user_id: string; team_id: string; text: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspaceByTeamId(body.team_id);
  const user = await refreshAdminStatus(
    client,
    await ensureUser(client, workspace, body.user_id)
  );
  if (!user.isAdmin) {
    await respond({
      response_type: "ephemeral",
      text: "Only workspace admins can reset the season.",
    });
    return;
  }

  // Require confirmation: `/hunch reset confirm`. This is destructive.
  const args = body.text.trim().split(/\s+/).filter(Boolean);
  args.shift(); // strip "reset"
  if (args[0] !== "confirm") {
    await respond({
      response_type: "ephemeral",
      text: `This will reset everyone to ${STARTING_COINS_AMOUNT.toLocaleString()} coins and void all open markets. To proceed, run \`/hunch reset confirm\`.`,
    });
    return;
  }

  const result = await resetSeason(workspace.id);
  await logEvent(workspace.id, "reset", {
    userId: body.user_id,
    metadata: { usersReset: result.usersReset, marketsVoided: result.marketsVoided },
  });
  await respond({
    response_type: "ephemeral",
    text: `Reset complete. ${result.usersReset} balances refreshed; ${result.marketsVoided} open markets voided.`,
  });
}
