# Hunch — Architecture

A Slack bot that lets a team express anonymous, well-calibrated beliefs about internal outcomes — and surfaces the aggregated signal to leaders. LMSR underneath, thoughtful poll on the surface.

## Data model

Stored in Postgres via Prisma. All records are scoped by `Workspace` so a future multi-tenant deploy can't leak data across teams.

| Model | Purpose | Key fields |
|---|---|---|
| `Workspace` | Single Slack team | `slackTeamId`, `name`, `memberCount`, `botUserId`, `botToken` |
| `User` | A Slack user we've seen | `slackUserId`, `username`, `coinBalance` (default 10,000), `isAdmin` |
| `Market` | A binary YES/NO question | `question`, `resolutionCriteria`, `deadline`, `channelId`, `messageTs`, `b`, `qYes`, `qNo`, `status`, `outcome` |
| `Bet` | A commitment by one user on one side | `marketId`, `userId`, `side`, `coinsCommitted`, `sharesReceived`, `priceAtBet` |
| `PriceSnapshot` | Internal probability over time, per market | `marketId`, `probability`, `recordedAt` |

`Bet.userId` exists for payouts and the user's own portfolio view, but is never rendered to other participants. The view layer at `src/slack/blocks.ts` is the trust boundary.

## LMSR math

Implemented at [`src/market/lmsr.ts`](../src/market/lmsr.ts). Pure functions, no I/O. Numerically stable via log-sum-exp. Covered by tests at [`tests/market.test.ts`](../tests/market.test.ts).

Liquidity at market creation:

```
b = (memberCount × 100) / ln(2)
```

YES probability:

```
p_yes = exp(qYes/b) / (exp(qYes/b) + exp(qNo/b))
```

Cost to move state by `(ΔYes, ΔNo)`:

```
cost = b · [ logsumexp((qYes+ΔYes)/b, (qNo+ΔNo)/b)
           - logsumexp(qYes/b, qNo/b) ]
```

Closed-form inverse — given a coin commitment `C` on YES, return shares `Δ`:

```
Δ = b · log( exp(C/b)·(exp(qYes/b)+exp(qNo/b)) − exp(qNo/b) ) − qYes
```

Shares pay out **1 coin each** on the winning side, 0 on the losing side. (The original spec said "100 coins per share" but combined with the b formula `N·100/ln(2)` that produced ~200× leverage on a single bet, which can't be right. The internally consistent reading is that the cost function is in coin units and shares pay 1 coin each — the `·100` in the b formula is what makes a 100-coin bet at midmarket meaningful, yielding ~2× returns. This is the calibration the spec was after.)

## Slack event flow

The three load-bearing events:

1. **`/hunch *`** — single slash command, subcommand-routed at `src/slack/app.ts`. Subcommands: `create | me | resolve | admin | leaderboard | reset | help`.
2. **`block_actions` on `open_bet_modal`** — fired when someone clicks "Place a hunch" on a market card. Opens the bet modal with their balance and a current preview.
3. **`view_submission` on `submit_bet`** — atomic transaction (`prisma.$transaction`):
   - validates side + coin amount
   - re-reads market state under the transaction to avoid races
   - decrements `User.coinBalance`
   - applies LMSR delta to `Market.qYes/qNo`
   - inserts a `Bet` and a `PriceSnapshot`
   - posts an ephemeral confirmation
   - re-renders the channel card with the new participant count

Other events:

- **OAuth install / startup provisioning** at `src/slack/workspace.ts`: on first boot, the bot reads its team identity, counts active non-bot members, and posts a welcome to `#general`.
- **`view_submission` on `submit_create_market`** at `src/handlers/create.ts`: validates inputs, computes `b`, posts the market card to the chosen channel.
- **`block_actions` on `resolve_yes` / `resolve_no`**: pays out winners in one transaction and posts the resolution card.

## Trust boundary: what each surface shows

| Surface | Shows | Hides |
|---|---|---|
| Channel market card (participant) | Question, resolution criteria, deadline, participant count, BET button | **Probability, price, odds, percentages** |
| Bet modal (participant) | Side picker, coin input, "if right you win X / if wrong you lose Y" derived from *their* commitment | Market price, anyone else's bets |
| `/hunch me` | Their own balance, open and resolved bets, all-time P&L | Other users' anything |
| `/hunch leaderboard` | Top 10 usernames + scores | Anyone's bet history |
| Resolution card (everyone) | Outcome, final aggregate probability, participant count | Individual identities tied to bets |
| `/hunch admin` (creator/admin only) | Per-market aggregate probability, YES/NO count, trend | Individual identities tied to bets |

The unit tests in `tests/market.test.ts` enforce the participant-card invariant: they serialize the card builder output and assert it contains no occurrence of "probability", "odds", "price", or any percentage. This test must pass on every commit.

## Anonymity invariant

`Bet.userId` is stored. It is rendered:

- in `/hunch me` (only the user's own bets)
- in the resolution payout step (only to credit the right user)
- never anywhere else

There is no participant-facing query that returns bets joined with usernames. The admin view aggregates `Bet` rows into counts and a probability — never identities.

## Deployment

- **Local dev:** Socket Mode. `npm run dev`. No public URL needed.
- **Production:** Single container from `Dockerfile`. Deploy to Railway or Fly.io. Set env vars; the container runs `prisma migrate deploy` then `node dist/src/index.js`. Either keep Socket Mode (fine for one workspace) or flip to HTTP mode by setting `SLACK_SOCKET_MODE=false` and pointing Slack interactivity URLs at `/slack/events`.

## What this codebase intentionally does NOT have

- Real-money flows. There is no Stripe, no payment processor, no withdrawal path. "coins" only.
- Live price tickers, order books, slippage UX, limit orders, leverage, short positions.
- Push notifications on price movement.
- A web frontend.
- Multi-tenancy infrastructure (the data model supports it but the install path assumes one workspace).
- Auto-resolution. Markets past their deadline stop accepting bets but stay `OPEN` until a creator/admin runs `/hunch resolve`.
