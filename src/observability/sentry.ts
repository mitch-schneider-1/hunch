// Error monitoring. Sentry is optional — degrade gracefully if SENTRY_DSN
// isn't set so self-hosters and local dev don't need a Sentry project.

import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("sentry: no SENTRY_DSN set — error reporting disabled");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
  initialized = true;
  console.log("sentry: initialized");
}

export function captureError(
  err: unknown,
  context: Record<string, unknown> = {}
): void {
  if (!initialized) {
    console.error("error", err, context);
    return;
  }
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) {
      scope.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}
