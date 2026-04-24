import { App, LogLevel } from "@slack/bolt";
import { registerCreateMarket } from "../handlers/create";
import { registerBet } from "../handlers/bet";
import { handleMe } from "../handlers/me";
import { handleResolveCommand, registerResolve } from "../handlers/resolve";
import { handleAdminCommand } from "../handlers/admin";
import { handleLeaderboard } from "../handlers/leaderboard";
import { handleResetCommand } from "../handlers/reset";

export function buildApp(): App {
  const useSocketMode = process.env.SLACK_SOCKET_MODE === "true";
  const logLevel =
    (process.env.LOG_LEVEL as LogLevel | undefined) ?? LogLevel.INFO;

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    socketMode: useSocketMode,
    appToken: useSocketMode ? process.env.SLACK_APP_TOKEN : undefined,
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

    try {
      switch (sub) {
        case "create":
        case "":
          // No subcommand → open the create modal.
          await client.views.open({
            trigger_id: command.trigger_id,
            view: (await import("./blocks")).buildCreateMarketModal(),
          });
          return;
        case "me":
          await handleMe(app, command, respond);
          return;
        case "resolve":
          await handleResolveCommand(
            app,
            { user_id: command.user_id, channel_id: command.channel_id, text },
            respond
          );
          return;
        case "admin":
          await handleAdminCommand(
            app,
            { user_id: command.user_id, channel_id: command.channel_id },
            respond
          );
          return;
        case "leaderboard":
          await handleLeaderboard(app, { user_id: command.user_id }, respond);
          return;
        case "reset":
          await handleResetCommand(
            app,
            { user_id: command.user_id, text },
            respond
          );
          return;
        case "help":
          await respond({
            response_type: "ephemeral",
            text:
              "*Hunch commands*\n" +
              "• `/hunch create` — ask the team a question\n" +
              "• `/hunch me` — your hunches and coins\n" +
              "• `/hunch resolve` — resolve a market you created (admins can resolve any)\n" +
              "• `/hunch admin` — aggregated signal across your markets (admins see all)\n" +
              "• `/hunch leaderboard` — top 10 by coin balance\n" +
              "• `/hunch reset confirm` — workspace admin: reset all coins, void open markets",
          });
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
