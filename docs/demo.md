# Hunch — 3-minute demo script

Run this top-to-bottom to see Hunch end-to-end. Three reviewers (Alice, Bob, Carol) — Alice is a workspace admin.

## Setup (one-time, ~30 seconds)

1. Boot the bot: `npm run dev`. Watch the welcome message land in `#general`.
2. Add the bot to a channel where you want to demo: `#hunches` is a good name. (`/invite @Hunch`.)

## 0:00 — Alice creates a market

Alice runs:

```
/hunch create
```

In the modal:

- Question: `Will we ship the mobile app by end of Q3?`
- How will we know: `Resolves YES if v1.0 is submitted to the App Store before Sep 30.`
- Resolution deadline: pick any future date
- Post in channel: `#hunches`

Submit. A market card lands in `#hunches`. Note: it shows the question, resolution criteria, deadline, "0 people have weighed in", and a `Place a hunch` button. **No probability, no price, no percentage.**

## 0:30 — Bob places a hunch

Bob clicks `Place a hunch` on the card. In the modal:

- Side: `YES`
- Coins: `500`

Submit. Bob gets an ephemeral confirmation: "Got it. Your hunch is recorded — 500 coins on YES." The card updates: "1 person has weighed in."

Bob runs `/hunch me`. He sees:

- Coin balance: 9,500
- Open hunches: one entry, "You bet YES with 500 coins"
- No price, no value, no current P&L

## 0:50 — Carol places a hunch on the other side

Carol clicks the same card. In the modal:

- Side: `NO`
- Coins: `1000`

Submit. Card updates: "2 people have weighed in." Carol can run `/hunch me` to see her own bet.

Now have 4–5 more teammates each place a small bet — split between YES and NO — to make the demo aggregate non-trivial. (Each of them gets 10,000 coins on first interaction.)

## 1:30 — Bob tries to peek at the aggregate

Bob runs `/hunch admin`. He sees ONLY his own market if he had created one. Since the only market is Alice's, the response is "No open markets to show." Confirms the participant boundary.

## 1:40 — Alice views the aggregate

Alice (admin / market creator) runs `/hunch admin`. She sees:

- The market question + deadline
- Aggregate: e.g., **62% YES**
- 3 YES bets, 4 NO bets
- Trend: `50% → 56% → 49% → 58% → 62%`

This is the only place the aggregate is visible.

## 2:00 — The leaderboard

Anyone runs `/hunch leaderboard`. They see top 10 usernames with their coin scores. No bet history. Bob, Carol, and other bettors show balance < 10,000 (because they have open commitments) — but their score includes those commitments at cost, so the ranking is consistent with "everyone starts at 10K."

## 2:20 — Alice resolves

Alice runs `/hunch resolve`. Ephemeral list of her open markets shows up, each with a `Resolved YES` and `Resolved NO` button. She clicks `Resolved YES`.

What happens:

- Every YES bettor gets `shares × 100` coins back (winners profit; the LMSR market made the YES bettors who got in early profit more per coin than late YES bettors)
- Every NO bettor gets 0 (loses their commitment)
- A resolution card lands in `#hunches`: "Resolved: YES — 7 people weighed in. The final aggregated forecast was 62% YES. The crowd had a hunch."

## 2:40 — Reviewers see their P&L

Bob runs `/hunch me`. He now sees:

- His new coin balance (above 9,500 because YES won)
- His resolved hunch: "Outcome: YES — you were right. P&L: +X coins"

Carol runs `/hunch me`. She sees:

- Coin balance 9,000 (didn't get her 1,000 back)
- Her resolved hunch: "Outcome: YES — you were wrong. P&L: -1,000 coins"

## 3:00 — End

Run `/hunch leaderboard` once more — now ranks have shifted based on resolved P&L only.

## Optional: reset

Alice (admin) runs `/hunch reset confirm`. Everyone is back to 10,000 coins, all open markets are voided.
