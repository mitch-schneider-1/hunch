import { Prisma, PrismaClient } from "@prisma/client";
import { captureError } from "./observability/sentry";

const SLOW_QUERY_MS = 500;

export const prisma = new PrismaClient({
  log: process.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
});

// Surface anything slower than SLOW_QUERY_MS to Sentry. With strangers
// installing, an unindexed query is the kind of thing that quietly
// degrades the whole app under load.
prisma.$use(async (params: Prisma.MiddlewareParams, next) => {
  const start = Date.now();
  try {
    return await next(params);
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed >= SLOW_QUERY_MS) {
      captureError(new Error(`slow query: ${params.model}.${params.action}`), {
        elapsedMs: elapsed,
        model: params.model,
        action: params.action,
      });
    }
  }
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
