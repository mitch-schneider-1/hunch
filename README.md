# Hunch

A Slack bot that lets a team express anonymous, well-calibrated beliefs about internal outcomes — and surfaces the aggregated signal to leaders.

LMSR underneath. Thoughtful poll on the surface.

## What it is (and isn't)

It is a forecasting tool. People ask questions ("Will we ship the mobile app by end of Q3?"), the team commits play-money hunches to YES or NO, and leaders see what the crowd actually believes.

It is **not** a trading platform. Participants never see the live aggregate probability — that prevents anchoring and information cascades. There is no order book, no live ticker, no leverage, no real money. Hunches are a calibration mechanism, not a currency.

## Just want to install it?

Hunch is a hosted multi-tenant Slack app. Install it directly from the landing page — no setup, no env vars. Self-hosting is for forks and contributors.

## Self-hosting

Hunch runs as a single multi-tenant HTTP-mode Bolt app. One deployment serves N workspaces; each workspace's bot token lives in the database, not env. You'll need a public HTTPS URL for the OAuth callback.

### 1. Create the Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest** → paste the contents of [`slack/manifest.json`](./slack/manifest.json). Update the `redirect_urls`, `request_url`, and event subscription URL to point at your deployment (e.g. `https://your-domain/slack/oauth_redirect` and `https://your-domain/slack/events`).

Under **Basic Information** copy these into your env:

- `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_STATE_SECRET` — any random 32+ char string

### 2. Configure environment

```bash
cp .env.example .env
# Fill in the four SLACK_* values above and a Postgres DATABASE_URL
```

A free Supabase or Railway Postgres is enough. For local dev:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb hunch
# Set DATABASE_URL=postgresql://localhost:5432/hunch in .env
```

For local OAuth testing, point Slack's redirect URL at an ngrok tunnel.

### 3. Migrate

```bash
npm install
npx prisma generate
npx prisma db push   # syncs schema to your DB
```

### 4. Run

```bash
npm run dev
```

You should see `hunch is up — port=3000`. Visit `/slack/install` to install into a workspace.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/hunch create` | anyone | open the create-market modal |
| `/hunch me` | anyone | your hunch balance, open and resolved bets, all-time P&L |
| `/hunch resolve` | creator or workspace admin | pick a market and resolve it YES or NO |
| `/hunch resolve <id> <yes\|no>` | creator or workspace admin | resolve directly without the picker |
| `/hunch admin` | creator or workspace admin | aggregated probability and trend across your markets |
| `/hunch leaderboard` | anyone | top 10 by hunch score |
| `/hunch reset confirm` | workspace admin only | reset everyone to 10K and void open markets |
| `/hunch help` | anyone | command list |

## Deployment

A `Dockerfile` is included. It runs `prisma migrate deploy` on boot.

```bash
docker build -t hunch .
docker run --rm \
  -e DATABASE_URL=... \
  -e SLACK_CLIENT_ID=... \
  -e SLACK_CLIENT_SECRET=... \
  -e SLACK_SIGNING_SECRET=... \
  -e SLACK_STATE_SECRET=... \
  -e SENTRY_DSN=... \
  -p 3000:3000 hunch
```

Deploy to Railway or Fly.io. Public HTTPS is required for OAuth. Set the redirect and event URLs in the Slack app dashboard to match your deployed domain.

## What's in this repo

```
docs/architecture.md   # data model, math, event flow, trust boundary
docs/demo.md           # 3-minute end-to-end demo script
slack/manifest.json    # Slack app manifest
src/market/lmsr.ts     # pure LMSR math (price, cost, shares-for-coins, payout)
src/slack/blocks.ts    # Block Kit builders — participant-facing builders never include market price
src/slack/workspace.ts # workspace provisioning + ensureUser (10K starting balance)
src/handlers/*.ts      # one file per command
src/index.ts           # entry: load env, boot Bolt, provision workspace
tests/market.test.ts   # math correctness + anonymity invariants
prisma/schema.prisma   # data model
```

## Tests

```bash
npm test
```

Covers LMSR math (price, cost, shares-for-coins inverse, payout) and the load-bearing anonymity invariant: the participant-facing market card must never contain the word "probability", "price", "odds", or any percentage.

## Design notes

See [`docs/architecture.md`](./docs/architecture.md) for the full data model and the trust boundary. The short version:

- LMSR is the mechanism. The math is exact, no approximations.
- The internal market price exists. It is shown only to admins and market creators in `/hunch admin`, and to everyone in the resolution card.
- Anonymity is absolute everywhere except the leaderboard (usernames + scores only — no bet history).
- Each user gets 10,000 hunches on first interaction. No replenishment. Going broke is part of the calibration mechanism.
