import { describe, expect, it } from "vitest";
import {
  applyBet,
  costToBuy,
  liquidityForWorkspace,
  payoutForBet,
  previewBet,
  priceYes,
  sharesForCoins,
} from "../src/market/lmsr";
import {
  buildAdminDashboard,
  buildBetConfirmation,
  buildBetModal,
  buildMarketCard,
  buildResolutionCard,
  type AdminMarketRow,
} from "../src/slack/blocks";
import { summarizeBets } from "../src/market/stats";

describe("LMSR price", () => {
  it("is 0.5 at the symmetric origin", () => {
    expect(priceYes(0, 0, 1000)).toBeCloseTo(0.5, 12);
  });

  it("rises above 0.5 when YES has more shares outstanding", () => {
    const p = priceYes(500, 0, 1000);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });

  it("converges to 1 as YES shares dominate", () => {
    expect(priceYes(100000, 0, 1000)).toBeCloseTo(1, 6);
  });
});

describe("LMSR cost", () => {
  it("is zero for a zero-share trade", () => {
    expect(costToBuy(100, 200, 1000, 0, 0)).toBeCloseTo(0, 12);
  });

  it("is strictly positive for any positive purchase", () => {
    expect(costToBuy(0, 0, 1000, 50, 0)).toBeGreaterThan(0);
    expect(costToBuy(0, 0, 1000, 0, 50)).toBeGreaterThan(0);
  });

  it("is monotone increasing in shares purchased", () => {
    const c1 = costToBuy(0, 0, 1000, 50, 0);
    const c2 = costToBuy(0, 0, 1000, 100, 0);
    expect(c2).toBeGreaterThan(c1);
  });
});

describe("sharesForCoins ↔ costToBuy inverse", () => {
  const cases: Array<[number, number, number, "YES" | "NO", number]> = [
    [0, 0, 1000, "YES", 100],
    [0, 0, 1000, "NO", 100],
    [200, 50, 1000, "YES", 500],
    [50, 200, 1000, "NO", 500],
    [1000, 1000, 7213, "YES", 250], // b ≈ liquidityForWorkspace(50)
    [3000, 1500, 7213, "YES", 1000],
    [3000, 1500, 7213, "NO", 1000],
  ];

  for (const [qY, qN, b, side, coins] of cases) {
    it(`shares(coins) round-trips for q=(${qY},${qN}) side=${side} coins=${coins}`, () => {
      const shares = sharesForCoins(qY, qN, b, side, coins);
      expect(shares).toBeGreaterThan(0);
      const dY = side === "YES" ? shares : 0;
      const dN = side === "NO" ? shares : 0;
      const recoveredCost = costToBuy(qY, qN, b, dY, dN);
      // Penny-precision: 0.0001 coins is well below any user-visible quantum.
      expect(recoveredCost).toBeCloseTo(coins, 4);
    });
  }
});

describe("previewBet", () => {
  it("returns potentialLoss equal to coins committed", () => {
    const p = previewBet(0, 0, 1000, "YES", 250);
    expect(p.potentialLoss).toBe(250);
  });

  it("computes a positive potential win at the symmetric origin", () => {
    // SHARE_PAYOUT = 1, so at p=0.5 the gross payout is ~2× commitment
    // for small bets relative to b. A 100-coin bet on b=1000 yields ~100
    // coins of profit (very slight slippage from the bet's own price impact).
    const p = previewBet(0, 0, 1000, "YES", 100);
    expect(p.potentialWin).toBeGreaterThan(0);
    expect(p.potentialWin).toBeLessThan(100); // strictly below 1× commitment
    expect(p.potentialWin).toBeGreaterThan(90); // close to 1× — modest slippage
  });

  it("yields lower expected win when betting against a strong consensus", () => {
    // q=(2000,0): YES is heavily favored, so a YES bet should win less.
    const yesAgainstFavorite = previewBet(2000, 0, 1000, "YES", 250);
    const noAgainstFavorite = previewBet(2000, 0, 1000, "NO", 250);
    // Underdog (NO) gets more shares per coin → larger potential win.
    expect(noAgainstFavorite.potentialWin).toBeGreaterThan(
      yesAgainstFavorite.potentialWin
    );
  });
});

describe("applyBet", () => {
  it("only adds shares to the side bet", () => {
    const r = applyBet(0, 0, 1000, "YES", 100);
    expect(r.qYes).toBeGreaterThan(0);
    expect(r.qNo).toBe(0);
  });

  it("price moves toward the side that was bet", () => {
    const before = priceYes(0, 0, 1000);
    const r = applyBet(0, 0, 1000, "YES", 250);
    expect(r.priceAfter).toBeGreaterThan(before);

    const r2 = applyBet(0, 0, 1000, "NO", 250);
    expect(r2.priceAfter).toBeLessThan(before);
  });
});

describe("payoutForBet", () => {
  it("pays 1 coin per share on the winning side", () => {
    expect(payoutForBet("YES", 4.2, "YES")).toBeCloseTo(4.2, 12);
  });
  it("pays nothing on the losing side", () => {
    expect(payoutForBet("YES", 4.2, "NO")).toBe(0);
  });
});

describe("liquidityForWorkspace", () => {
  it("scales linearly with member count", () => {
    const b1 = liquidityForWorkspace(50);
    const b2 = liquidityForWorkspace(100);
    expect(b2 / b1).toBeCloseTo(2, 12);
  });
  it("stays positive for tiny workspaces", () => {
    expect(liquidityForWorkspace(1)).toBeGreaterThan(0);
    expect(liquidityForWorkspace(0)).toBeGreaterThan(0);
  });
});

// === ANONYMITY / NO-PRICE-LEAK INVARIANTS ===
// These tests are the trust boundary for participant-facing UI.
// If they ever fail, the product has leaked the aggregated signal.

describe("participant-facing market card never leaks the market price", () => {
  const market = {
    id: "m_1",
    creatorSlackUserId: "U_CREATOR",
    question: "Will we ship the mobile app by EOQ3?",
    resolutionCriteria: "Counts when we tag v1.0 and submit to App Store.",
    deadline: new Date("2026-09-30T00:00:00Z"),
    participantCount: 12,
    status: "OPEN" as const,
  };

  const card = buildMarketCard(market);
  const serialized = JSON.stringify(card).toLowerCase();

  it("contains no occurrence of the word 'probability'", () => {
    expect(serialized).not.toContain("probability");
  });

  it("contains no occurrence of the word 'odds'", () => {
    expect(serialized).not.toContain("odds");
  });

  it("contains no percent-formatted number", () => {
    // Match things like "57%", "12.4 %", etc.
    expect(serialized).not.toMatch(/\d+\s*%/);
  });

  it("does not mention 'price'", () => {
    expect(serialized).not.toContain("price");
  });
});

describe("blind LMSR: bet modal shows no payout or price signal", () => {
  // The modal is static — pick a side + amount, no payout preview. Showing a
  // payout would let a user toggle YES/NO and read off the hidden probability.
  const serialized = JSON.stringify(
    buildBetModal({
      marketId: "m_1",
      question: "Will we ship?",
      defaultCoins: 100,
      maxCoins: 10000,
    })
  ).toLowerCase();

  it("contains no probability/odds/price/percent", () => {
    expect(serialized).not.toContain("probability");
    expect(serialized).not.toContain("odds");
    expect(serialized).not.toContain("price");
    expect(serialized).not.toMatch(/\d+\s*%/);
  });

  it("shows no payout figure (the old leak: 'win ~N' / 'you lose N')", () => {
    expect(serialized).not.toContain("win ~");
    expect(serialized).not.toContain("you lose");
  });

  it("tells the user the payout is revealed at resolution", () => {
    expect(serialized).toContain("revealed when the question resolves");
  });

  it("takes no side/amount preview input (nothing to toggle and read)", () => {
    // The builder signature no longer accepts preview/selectedSide/draftCoins,
    // so output cannot depend on the chosen side — the leak is structurally gone.
    const a = JSON.stringify(buildBetModal({ marketId: "m", question: "Q", defaultCoins: 100, maxCoins: 1000 }));
    const b = JSON.stringify(buildBetModal({ marketId: "m", question: "Q", defaultCoins: 100, maxCoins: 1000 }));
    expect(a).toBe(b);
  });
});

describe("blind LMSR: bet confirmation shows no payout", () => {
  const serialized = JSON.stringify(
    buildBetConfirmation({
      side: "YES",
      coins: 500,
      deadline: new Date("2026-09-30T00:00:00Z"),
    })
  ).toLowerCase();

  it("confirms side + amount but defers the payout to resolution", () => {
    expect(serialized).toContain("500 hunches on yes");
    expect(serialized).toContain("revealed when the question resolves");
  });

  it("does not leak a payout figure or percentage", () => {
    expect(serialized).not.toContain("win ~");
    expect(serialized).not.toContain("you lose");
    expect(serialized).not.toMatch(/\d+\s*%/);
  });
});

describe("summarizeBets — exec concentration math (per user)", () => {
  it("counts a user once even when they place several bets", () => {
    const r = summarizeBets([
      { side: "YES", coinsCommitted: 100, userId: "u1" },
      { side: "YES", coinsCommitted: 200, userId: "u1" },
      { side: "NO", coinsCommitted: 50, userId: "u2" },
    ]);
    expect(r.distinctBettors).toBe(2);
    expect(r.yesStake).toBe(300);
    expect(r.noStake).toBe(50);
    expect(r.totalStake).toBe(350);
    // u1's two bets sum to 300/350 — concentration is per user, not per bet.
    expect(r.topUserShare).toBeCloseTo(300 / 350, 12);
  });

  it("returns zeros for no bets", () => {
    const r = summarizeBets([]);
    expect(r.distinctBettors).toBe(0);
    expect(r.totalStake).toBe(0);
    expect(r.topUserShare).toBe(0);
  });

  it("topUserShare is 1 when one user holds the whole pool", () => {
    const r = summarizeBets([
      { side: "YES", coinsCommitted: 500, userId: "u1" },
      { side: "NO", coinsCommitted: 100, userId: "u1" },
    ]);
    expect(r.distinctBettors).toBe(1);
    expect(r.topUserShare).toBe(1);
  });
});

describe("exec dashboard — anonymity gate + signal", () => {
  function row(overrides: Partial<AdminMarketRow> = {}): AdminMarketRow {
    return {
      id: "m_1",
      question: "Will we ship?",
      deadline: new Date("2026-09-30T00:00:00Z"),
      distinctBettors: 6,
      currentProbability: 0.62,
      trend: [0.5, 0.55, 0.62],
      yesStake: 700,
      noStake: 300,
      topUserShare: 0.2,
      creatorPrior: null,
      rationales: [],
      ...overrides,
    };
  }

  it("hides ALL detail below 5 distinct bettors", () => {
    const s = JSON.stringify(
      buildAdminDashboard([
        row({
          distinctBettors: 3,
          creatorPrior: 0.7,
          rationales: [{ side: "NO" as never, text: "secret reason" }],
        }),
      ])
    );
    expect(s).toContain("(3/5)");
    expect(s).not.toContain("62%"); // aggregate hidden
    expect(s).not.toContain("Stake:"); // stake split hidden
    expect(s).not.toContain("Your call:"); // prior hidden
    expect(s).not.toContain("secret reason"); // rationale hidden
  });

  it("shows team probability + stake split at/above 5 bettors", () => {
    const s = JSON.stringify(buildAdminDashboard([row({ distinctBettors: 6 })]));
    expect(s).toContain("62% YES"); // team aggregate
    expect(s).toContain("Stake:");
    expect(s).toContain("70% YES / 30% NO"); // 700/300 stake split
  });

  it("renders the creator-prior comparison with a directional gap", () => {
    const s = JSON.stringify(
      buildAdminDashboard([
        row({ distinctBettors: 6, creatorPrior: 0.7, currentProbability: 0.62 }),
      ])
    );
    expect(s).toContain("Your call:");
    expect(s).toContain("+8 pts more bullish"); // 70 - 62
  });

  it("flags concentration only when one user holds > 40% of stake", () => {
    const flagged = JSON.stringify(
      buildAdminDashboard([row({ distinctBettors: 6, topUserShare: 0.55 })])
    );
    expect(flagged).toContain("⚠️");
    expect(flagged).toContain("55%");

    const fine = JSON.stringify(
      buildAdminDashboard([row({ distinctBettors: 6, topUserShare: 0.3 })])
    );
    expect(fine).not.toContain("⚠️");
  });

  it("shows anonymous side-tagged rationales above the gate", () => {
    const s = JSON.stringify(
      buildAdminDashboard([
        row({
          distinctBettors: 6,
          rationales: [
            { side: "NO" as never, text: "contract not signed" },
            { side: "YES" as never, text: "demo went well" },
          ],
        }),
      ])
    );
    expect(s).toContain("Why people bet this way");
    expect(s).toContain("(NO) contract not signed");
    expect(s).toContain("(YES) demo went well");
  });
});

describe("resolution card discloses the final aggregated probability", () => {
  // Once a market is resolved the aggregate is safe to show — by spec.
  const card = buildResolutionCard({
    question: "Will we ship the mobile app by EOQ3?",
    outcome: "YES",
    finalProbability: 0.68,
    participantCount: 47,
  });
  const serialized = JSON.stringify(card);

  it("does include the final probability after resolution", () => {
    expect(serialized).toContain("68%");
  });
});
