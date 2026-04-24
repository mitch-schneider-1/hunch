import "dotenv/config";
import { buildApp } from "./slack/app";
import { provisionWorkspaceOnStartup } from "./slack/workspace";
import { disconnectDb } from "./db";

async function main(): Promise<void> {
  const requiredEnv = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "DATABASE_URL"];
  for (const k of requiredEnv) {
    if (!process.env[k]) {
      throw new Error(`Missing required env var: ${k}`);
    }
  }
  if (process.env.SLACK_SOCKET_MODE === "true" && !process.env.SLACK_APP_TOKEN) {
    throw new Error("SLACK_SOCKET_MODE=true requires SLACK_APP_TOKEN");
  }

  const app = buildApp();

  // Boot the bot first so we can call Web API methods for provisioning.
  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  console.log(`hunch is up — port=${port} socket=${process.env.SLACK_SOCKET_MODE === "true"}`);

  await provisionWorkspaceOnStartup(app);

  const shutdown = async () => {
    console.log("shutting down");
    try {
      await app.stop();
    } catch {
      // ignore
    }
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
