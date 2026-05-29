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
    // Defense in depth: never let a Slack token reach Sentry. Bolt errors
    // can carry token-bearing context; scrub anything that looks like an
    // xoxb-/xoxp-/xapp-/xoxe- token from the serialized event.
    beforeSend(event) {
      const scrubbed = JSON.stringify(event).replace(
        /xox[abpres]-[A-Za-z0-9-]+/g,
        "[REDACTED-SLACK-TOKEN]"
      );
      return JSON.parse(scrubbed);
    },
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
