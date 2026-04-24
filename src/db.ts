import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
