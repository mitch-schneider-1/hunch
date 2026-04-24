// Logarithmic Market Scoring Rule — pure math.
//
// Notation:
//   b      = liquidity parameter (constant per market, in coin units)
//   qYes   = total YES shares outstanding
//   qNo    = total NO shares outstanding
//
// Cost function (cost in coins to take share state from (qYes, qNo) to (qYes+ΔY, qNo+ΔN)):
//   C(q) = b * ln( exp(qYes/b) + exp(qNo/b) )
//   cost = C(qYes+ΔY, qNo+ΔN) - C(qYes, qNo)
//
// Internal price of YES (i.e., probability):
//   p_yes = exp(qYes/b) / ( exp(qYes/b) + exp(qNo/b) )
//
// Each share pays out 1 coin on its winning side. (The cost function is
// in the same units as the per-share payout — that's the LMSR contract.
// We use coin-units throughout, so 1 coin payout per share is the
// internally consistent choice. The b formula `N * 100 / ln(2)` is then
// calibrated so a ~100-coin bet at midmarket yields a ~2× potential
// return — which is what "100 units of meaningful position size" means.)
//
// All formulas are implemented with a log-sum-exp trick for numerical
// stability so we don't overflow exp() once q's get large.

export const SHARE_PAYOUT = 1;

/**
 * `b` is auto-tuned at market creation so each member of the workspace
 * has roughly enough liquidity to take a meaningful 100-coin position.
 *   b = (memberCount * 100) / ln(2)
 * The /ln(2) factor makes it so that committing ~b*ln(2) coins moves
 * the implied probability by a non-trivial amount.
 */
export function liquidityForWorkspace(memberCount: number): number {
  const safe = Math.max(1, memberCount);
  return (safe * 100) / Math.LN2;
}

// log(exp(x) + exp(y)) — stable.
function logSumExp(x: number, y: number): number {
  const m = Math.max(x, y);
  if (!isFinite(m)) return m;
  return m + Math.log(Math.exp(x - m) + Math.exp(y - m));
}

/**
 * Internal probability of YES given the current share state.
 * Range: (0, 1). Never rendered to participants — admin view only.
 */
export function priceYes(qYes: number, qNo: number, b: number): number {
  const a = qYes / b;
  const c = qNo / b;
  const m = Math.max(a, c);
  const ea = Math.exp(a - m);
  const ec = Math.exp(c - m);
  return ea / (ea + ec);
}

/**
 * Coins required to move share state from (qYes, qNo) to (qYes+ΔYes, qNo+ΔNo).
 * For a single-side bet, set the other delta to 0.
 */
export function costToBuy(
  qYes: number,
  qNo: number,
  b: number,
  deltaYes: number,
  deltaNo: number
): number {
  const before = b * logSumExp(qYes / b, qNo / b);
  const after = b * logSumExp((qYes + deltaYes) / b, (qNo + deltaNo) / b);
  return after - before;
}

/**
 * Inverse of cost(): given a coin commitment `coins` on `side`, return
 * the number of shares the user receives at the current market state.
 *
 * Closed-form inverse:
 *   Let A = exp(qYes/b), B = exp(qNo/b), C = coins.
 *   For YES:  exp((qYes + Δ)/b) = exp(C/b) * (A + B) - B
 *             Δ = b * log(exp(C/b)*(A+B) - B) - qYes
 *   For NO:  symmetric.
 *
 * Implemented in log-space to stay stable.
 */
export function sharesForCoins(
  qYes: number,
  qNo: number,
  b: number,
  side: "YES" | "NO",
  coins: number
): number {
  if (coins <= 0) return 0;

  const a = qYes / b;
  const c = qNo / b;
  const lse0 = logSumExp(a, c); // log(A+B)
  const target = coins / b + lse0; // log(exp(C/b)*(A+B))

  // log(exp(target) - exp(otherSideExponent))  — stable.
  const otherExp = side === "YES" ? c : a;
  // target > otherExp because cost is strictly positive on this side.
  const diff = target + Math.log1p(-Math.exp(otherExp - target));

  const ownExpBefore = side === "YES" ? a : c;
  const deltaOverB = diff - ownExpBefore;
  return deltaOverB * b;
}

export interface BetPreview {
  shares: number;
  potentialWin: number; // coins gained if their side wins
  potentialLoss: number; // coins forfeited if their side loses (= coins committed)
  priceAtBet: number; // YES probability at moment of bet — INTERNAL ONLY
}

/**
 * Compute everything we need to show on the bet modal — except we
 * surface only `potentialWin` and `potentialLoss` to participants.
 * `priceAtBet` is recorded server-side for the admin trend view.
 */
export function previewBet(
  qYes: number,
  qNo: number,
  b: number,
  side: "YES" | "NO",
  coins: number
): BetPreview {
  const shares = sharesForCoins(qYes, qNo, b, side, coins);
  const grossPayout = shares * SHARE_PAYOUT;
  const potentialWin = Math.max(0, grossPayout - coins);

  // Probability snapshot AFTER this hypothetical bet. We snapshot the
  // post-bet price because that's what the next participant would face.
  const newQYes = side === "YES" ? qYes + shares : qYes;
  const newQNo = side === "NO" ? qNo + shares : qNo;
  const priceAtBet = priceYes(newQYes, newQNo, b);

  return {
    shares,
    potentialWin,
    potentialLoss: coins,
    priceAtBet,
  };
}

/**
 * Apply a bet to market state. Returns the updated (qYes, qNo) and the
 * shares awarded. Pure — caller persists the result.
 */
export function applyBet(
  qYes: number,
  qNo: number,
  b: number,
  side: "YES" | "NO",
  coins: number
): { qYes: number; qNo: number; shares: number; priceAfter: number } {
  const shares = sharesForCoins(qYes, qNo, b, side, coins);
  const newQYes = side === "YES" ? qYes + shares : qYes;
  const newQNo = side === "NO" ? qNo + shares : qNo;
  return {
    qYes: newQYes,
    qNo: newQNo,
    shares,
    priceAfter: priceYes(newQYes, newQNo, b),
  };
}

/**
 * Payout for a single bet given the resolution outcome.
 * Returns the gross coin payout (not the P&L). P&L = payout - coinsCommitted.
 */
export function payoutForBet(
  side: "YES" | "NO",
  shares: number,
  outcome: "YES" | "NO"
): number {
  if (side !== outcome) return 0;
  return shares * SHARE_PAYOUT;
}
