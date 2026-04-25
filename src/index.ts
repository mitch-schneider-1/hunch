import "dotenv/config";
import { buildApp } from "./slack/app";
import { disconnectDb } from "./db";
import { captureError, initSentry } from "./observability/sentry";

async function main(): Promise<void> {
  initSentry();
  const requiredEnv = [
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "SLACK_STATE_SECRET",
    "DATABASE_URL",
  ];
  for (const k of requiredEnv) {
    if (!process.env[k]) {
      throw new Error(`Missing required env var: ${k}`);
    }
  }

  const app = buildApp();

  app.error(async (err) => {
    captureError(err);
  });

  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  console.log(`hunch is up — port=${port}`);

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
