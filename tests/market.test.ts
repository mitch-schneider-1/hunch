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
import { buildBetModal, buildMarketCard, buildResolutionCard } from "../src/slack/blocks";

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

describe("participant-facing bet modal never leaks the market price", () => {
  // The modal in any state — incomplete, invalid, ready — must never disclose
  // the market probability. The "ready" preview shows win/lose in coins only.
  const states: Array<{
    label: string;
    modal: ReturnType<typeof buildBetModal>;
  }> = [
    {
      label: "incomplete",
      modal: buildBetModal({
        marketId: "m_1",
        question: "Will we ship?",
        defaultCoins: 100,
        maxCoins: 10000,
        preview: { state: "incomplete" },
      }),
    },
    {
      label: "ready",
      modal: buildBetModal({
        marketId: "m_1",
        question: "Will we ship?",
        defaultCoins: 100,
        maxCoins: 10000,
        selectedSide: "YES",
        draftCoins: "500",
        preview: {
          state: "ready",
          potentialWin: 487,
          potentialLoss: 500,
        },
      }),
    },
  ];

  for (const s of states) {
    const serialized = JSON.stringify(s.modal).toLowerCase();
    it(`(${s.label}) does not contain "probability"`, () => {
      expect(serialized).not.toContain("probability");
    });
    it(`(${s.label}) does not contain "odds"`, () => {
      expect(serialized).not.toContain("odds");
    });
    it(`(${s.label}) does not contain a percent-formatted number`, () => {
      expect(serialized).not.toMatch(/\d+\s*%/);
    });
    it(`(${s.label}) does not contain "price"`, () => {
      expect(serialized).not.toContain("price");
    });
  }
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
