import { App, LogLevel } from "@slack/bolt";
import { registerCreateMarket } from "../handlers/create";
import { registerBet } from "../handlers/bet";
import { handleMe } from "../handlers/me";
import { handleResolveCommand, registerResolve } from "../handlers/resolve";
import { handleAdminCommand } from "../handlers/admin";
import { handleLeaderboard } from "../handlers/leaderboard";
import { handleResetCommand } from "../handlers/reset";
import { installationStore } from "./install-store";
import { logEvent } from "../observability/events";
import { getWorkspaceByTeamId } from "./workspace";

export function buildApp(): App {
  const logLevel =
    (process.env.LOG_LEVEL as LogLevel | undefined) ?? LogLevel.INFO;

  // HTTP-mode OAuth Bolt app. Tokens come from the per-workspace
  // installationStore, not from process env.
  // PUBLIC_URL pins the OAuth redirect to our public hostname so the state
  // cookie domain matches the callback domain. Without this, Bolt derives
  // the redirect from the request host header, which on Railway can resolve
  // to the internal *.up.railway.app hostname and break state validation.
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
  const redirectUri = publicUrl
    ? `${publicUrl}/slack/oauth_redirect`
    : undefined;

  const app = new App({
    clientId: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    stateSecret: process.env.SLACK_STATE_SECRET!,
    scopes: [
      "channels:read",
      "chat:write",
      "chat:write.public",
      "commands",
      "groups:read",
      "im:write",
      "users:read",
    ],
    installationStore,
    redirectUri,
    installerOptions: {
      directInstall: true,
      redirectUriPath: "/slack/oauth_redirect",
    },
    logLevel,
  });

  registerCreateMarket(app);
  registerBet(app);
  registerResolve(app);
  registerSlashRouter(app);

  return app;
}

function registerSlashRouter(app: App): void {
  // Single slash command `/hunch` with subcommands.
  app.command("/hunch", async ({ ack, command, respond, client }) => {
    await ack();
    const text = command.text?.trim() ?? "";
    const sub = text.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    const teamId = command.team_id;

    // Best-effort workspace lookup for analytics. Doesn't block the command.
    void recordCommand(teamId, command.user_id, sub || "help_default");

    try {
      switch (sub) {
        case "":
        case "help":
          // No subcommand or explicit help → interactive help card with
          // a primary "Ask the team a question" button.
          await respond({
            response_type: "ephemeral",
            text: "Hunch help",
            blocks: (await import("./blocks")).buildHelpCard(),
          });
          return;
        case "create":
          await client.views.open({
            trigger_id: command.trigger_id,
            view: (await import("./blocks")).buildCreateMarketModal(),
          });
          return;
        case "me":
          await handleMe(
            client,
            { user_id: command.user_id, team_id: teamId, channel_id: command.channel_id },
            respond
          );
          return;
        case "resolve":
          await handleResolveCommand(
            client,
            { user_id: command.user_id, team_id: teamId, channel_id: command.channel_id, text },
            respond
          );
          return;
        case "admin":
          await handleAdminCommand(
            client,
            { user_id: command.user_id, team_id: teamId, channel_id: command.channel_id },
            respond
          );
          return;
        case "leaderboard":
          await handleLeaderboard(
            client,
            { user_id: command.user_id, team_id: teamId },
            respond
          );
          return;
        case "reset":
          await handleResetCommand(
            client,
            { user_id: command.user_id, team_id: teamId, text },
            respond
          );
          return;
        default:
          await respond({
            response_type: "ephemeral",
            text: `Unknown command \`${sub}\`. Try \`/hunch help\`.`,
          });
      }
    } catch (err) {
      const msg = (err as Error).message ?? "Unknown error";
      await respond({
        response_type: "ephemeral",
        text: `Something went wrong: ${msg}`,
      });
      console.error("slash command failed", err);
    }
  });
}

async function recordCommand(
  teamId: string,
  slackUserId: string,
  sub: string
): Promise<void> {
  try {
    const ws = await getWorkspaceByTeamId(teamId);
    await logEvent(ws.id, "command_used", {
      userId: slackUserId,
      metadata: { sub },
    });
  } catch (err) {
    // Workspace might not exist yet (first install race). Swallow.
    console.error("recordCommand failed", { teamId, sub, err });
  }
}
