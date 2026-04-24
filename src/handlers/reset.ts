import type { App, RespondFn } from "@slack/bolt";
import {
  ensureUser,
  getWorkspace,
  refreshAdminStatus,
  resetSeason,
  STARTING_COINS_AMOUNT,
} from "../slack/workspace";

export async function handleResetCommand(
  app: App,
  body: { user_id: string; text: string },
  respond: RespondFn
): Promise<void> {
  const workspace = await getWorkspace();
  const user = await refreshAdminStatus(
    app.client,
    await ensureUser(app.client, workspace, body.user_id)
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
  await respond({
    response_type: "ephemeral",
    text: `Reset complete. ${result.usersReset} balances refreshed; ${result.marketsVoided} open markets voided.`,
  });
}
