// Trust boundary: verify zero cross-tenant leakage.
//
// Hunch runs one process across N workspaces. A single unscoped query is
// catastrophic — one team can read another team's anonymous bets. This
// test stands up two workspaces with overlapping Slack user ids and
// asserts every read path returns only that workspace's data.
//
// Skips automatically if TEST_DATABASE_URL is not set, so it doesn't
// break local `npm test` runs without a database.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const TEST_DB = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb("multi-tenant trust boundary", () => {
  // Same Slack user id used across two workspaces — the most dangerous case.
  const SHARED_SLACK_USER = "U_SHARED";

  let prisma: PrismaClient;
  let wsA: { id: string };
  let wsB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let marketA: { id: string };
  let marketB: { id: string };

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB! } },
    });

    // Clean slate. Use unique team ids so re-runs don't clash.
    const teamA = `T_TEST_A_${Date.now()}`;
    const teamB = `T_TEST_B_${Date.now()}`;

    wsA = await prisma.workspace.create({
      data: {
        slackTeamId: teamA,
        name: "Workspace A",
        memberCount: 10,
        botUserId: "BUSER_A",
        botToken: "xoxb-test-A",
        installationJson: { team: { id: teamA } },
      },
    });
    wsB = await prisma.workspace.create({
      data: {
        slackTeamId: teamB,
        name: "Workspace B",
        memberCount: 10,
        botUserId: "BUSER_B",
        botToken: "xoxb-test-B",
        installationJson: { team: { id: teamB } },
      },
    });

    userA = await prisma.user.create({
      data: {
        workspaceId: wsA.id,
        slackUserId: SHARED_SLACK_USER,
        username: "shared-name-A",
        coinBalance: 10_000,
      },
    });
    userB = await prisma.user.create({
      data: {
        workspaceId: wsB.id,
        slackUserId: SHARED_SLACK_USER,
        username: "shared-name-B",
        coinBalance: 10_000,
      },
    });

    marketA = await prisma.market.create({
      data: {
        workspaceId: wsA.id,
        creatorUserId: userA.id,
        question: "A-only secret market",
        resolutionCriteria: "n/a",
        deadline: new Date(Date.now() + 86_400_000),
        channelId: "C_A",
        b: 1000,
      },
    });
    marketB = await prisma.market.create({
      data: {
        workspaceId: wsB.id,
        creatorUserId: userB.id,
        question: "B-only secret market",
        resolutionCriteria: "n/a",
        deadline: new Date(Date.now() + 86_400_000),
        channelId: "C_B",
        b: 1000,
      },
    });

    await prisma.bet.create({
      data: {
        marketId: marketA.id,
        userId: userA.id,
        side: "YES",
        coinsCommitted: 100,
        sharesReceived: 100,
        priceAtBet: 0.5,
      },
    });
    await prisma.bet.create({
      data: {
        marketId: marketB.id,
        userId: userB.id,
        side: "NO",
        coinsCommitted: 200,
        sharesReceived: 200,
        priceAtBet: 0.5,
      },
    });
  });

  afterAll(async () => {
    if (wsA) await prisma.workspace.delete({ where: { id: wsA.id } }).catch(() => {});
    if (wsB) await prisma.workspace.delete({ where: { id: wsB.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("same slackUserId in two workspaces produces two distinct User rows", () => {
    expect(userA.id).not.toBe(userB.id);
  });

  it("market lookup scoped by workspaceId never returns the other workspace's market", async () => {
    const aMarkets = await prisma.market.findMany({ where: { workspaceId: wsA.id } });
    const bMarkets = await prisma.market.findMany({ where: { workspaceId: wsB.id } });
    expect(aMarkets.map((m) => m.id)).toEqual([marketA.id]);
    expect(bMarkets.map((m) => m.id)).toEqual([marketB.id]);
  });

  it("user lookup by (workspaceId, slackUserId) returns the workspace-correct row", async () => {
    const fromA = await prisma.user.findUnique({
      where: { workspaceId_slackUserId: { workspaceId: wsA.id, slackUserId: SHARED_SLACK_USER } },
    });
    const fromB = await prisma.user.findUnique({
      where: { workspaceId_slackUserId: { workspaceId: wsB.id, slackUserId: SHARED_SLACK_USER } },
    });
    expect(fromA?.id).toBe(userA.id);
    expect(fromB?.id).toBe(userB.id);
    expect(fromA?.username).toBe("shared-name-A");
    expect(fromB?.username).toBe("shared-name-B");
  });

  // Mirrors the defense-in-depth bet query used by handlers/me.ts.
  it("bet lookup via market relation never crosses workspaces", async () => {
    const aBets = await prisma.bet.findMany({
      where: { userId: userA.id, market: { workspaceId: wsA.id } },
      include: { market: true },
    });
    expect(aBets).toHaveLength(1);
    expect(aBets[0].market.workspaceId).toBe(wsA.id);

    // Even with the same slack user id, scoping by market relation prevents
    // cross-tenant data appearing if userId ever overlaps.
    const aBetsScopedToB = await prisma.bet.findMany({
      where: { userId: userA.id, market: { workspaceId: wsB.id } },
    });
    expect(aBetsScopedToB).toHaveLength(0);
  });

  it("leaderboard scoped to a workspace omits the other workspace's users", async () => {
    const usersA = await prisma.user.findMany({ where: { workspaceId: wsA.id } });
    const usersB = await prisma.user.findMany({ where: { workspaceId: wsB.id } });
    expect(usersA.every((u) => u.workspaceId === wsA.id)).toBe(true);
    expect(usersB.every((u) => u.workspaceId === wsB.id)).toBe(true);
    expect(usersA.find((u) => u.id === userB.id)).toBeUndefined();
    expect(usersB.find((u) => u.id === userA.id)).toBeUndefined();
  });

  it("priceSnapshot via market relation respects workspace scoping", async () => {
    await prisma.priceSnapshot.create({
      data: { marketId: marketA.id, probability: 0.6 },
    });
    const aSnaps = await prisma.priceSnapshot.findMany({
      where: { market: { workspaceId: wsA.id } },
    });
    const bSnaps = await prisma.priceSnapshot.findMany({
      where: { market: { workspaceId: wsB.id } },
    });
    expect(aSnaps.length).toBeGreaterThan(0);
    expect(aSnaps.every((s) => s.marketId === marketA.id)).toBe(true);
    expect(bSnaps.every((s) => s.marketId === marketB.id)).toBe(true);
  });

  it("EventLog insertion stays scoped to the originating workspace", async () => {
    await prisma.eventLog.create({
      data: { workspaceId: wsA.id, eventType: "market_created", marketId: marketA.id },
    });
    const aEvents = await prisma.eventLog.findMany({ where: { workspaceId: wsA.id } });
    const bEvents = await prisma.eventLog.findMany({ where: { workspaceId: wsB.id } });
    expect(aEvents.length).toBeGreaterThan(0);
    expect(aEvents.every((e) => e.workspaceId === wsA.id)).toBe(true);
    expect(bEvents.every((e) => e.workspaceId === wsB.id)).toBe(true);
  });
});
