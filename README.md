# Hunch

A Slack bot that lets a team express anonymous, well-calibrated beliefs about internal outcomes — and surfaces the aggregated signal to leaders.

LMSR underneath. Thoughtful poll on the surface.

## What it is (and isn't)

It is a forecasting tool. People ask questions ("Will we ship the mobile app by end of Q3?"), the team commits play-money coins to YES or NO, and leaders see what the crowd actually believes.

It is **not** a trading platform. Participants never see the live aggregate probability — that prevents anchoring and information cascades. There is no order book, no live ticker, no leverage, no real money. Coins are a calibration mechanism, not a currency.

## Setup

### 1. Create the Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest** → paste the contents of [`slack/manifest.json`](./slack/manifest.json).

Then, under **Basic Information**:

- Generate an **App-Level Token** with the `connections:write` scope. Copy it as `SLACK_APP_TOKEN` (starts with `xapp-`).

Under **OAuth & Permissions** → **Install to Workspace**. Authorize. Copy the bot token as `SLACK_BOT_TOKEN` (starts with `xoxb-`).

Under **Basic Information** → **Signing Secret** → copy as `SLACK_SIGNING_SECRET`.

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with the three Slack values above and a Postgres DATABASE_URL
```

A free Supabase or Railway Postgres is enough. For local dev:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb hunch
# Set DATABASE_URL=postgresql://localhost:5432/hunch in .env
```

### 3. Migrate

```bash
npm install
npx prisma generate
npx prisma db push   # syncs schema to your DB (MVP — switch to migrate dev once you have prod data)
```

### 4. Run

```bash
npm run dev
```

You should see `hunch is up — port=3000 socket=true` and a welcome message in your workspace's `#general`.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/hunch create` | anyone | open the create-market modal |
| `/hunch me` | anyone | your coin balance, open and resolved hunches, all-time P&L |
| `/hunch resolve` | creator or workspace admin | pick a market and resolve it YES or NO |
| `/hunch resolve <id> <yes\|no>` | creator or workspace admin | resolve directly without the picker |
| `/hunch admin` | creator or workspace admin | aggregated probability and trend across your markets |
| `/hunch leaderboard` | anyone | top 10 by coin score |
| `/hunch reset confirm` | workspace admin only | reset everyone to 10K and void open markets |
| `/hunch help` | anyone | command list |

## Deployment

A `Dockerfile` is included. It runs `prisma migrate deploy` on boot.

```bash
docker build -t hunch .
docker run --rm \
  -e DATABASE_URL=... \
  -e SLACK_BOT_TOKEN=... \
  -e SLACK_SIGNING_SECRET=... \
  -e SLACK_APP_TOKEN=... \
  -e SLACK_SOCKET_MODE=true \
  -p 3000:3000 hunch
```

Deploy to Railway or Fly.io with the same env vars. Socket Mode is recommended (no public HTTP endpoint required).

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
- Each user gets 10,000 coins on first interaction. No replenishment. Going broke is part of the calibration mechanism.
