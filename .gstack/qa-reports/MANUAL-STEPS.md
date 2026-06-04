# Hunch — your manual checklist (everything I couldn't do for you)

Last updated: 2026-05-29

I already wrote and committed all the code. Below is only the stuff that needs you —
because it touches Railway, the Slack dashboard, your production database, or a push
you asked to do yourself.

There are **two branches** ready to push:
- `mitch-schneider-1/gstack-portability-check` — 8 commits (landing fixes + hardening). Safe to ship now.
- `mitch-schneider-1/prisma-migrations` — 1 commit (DB migration). **Ship LAST, after Step 4.**

---

## STEP 1 — Ship the safe branch (5 min)

```bash
cd /Users/mitchelschneider/conductor/workspaces/hunch-v1/muscat

# Drop the stray .gitignore change (a tool added it; not needed)
git checkout -- .gitignore

# Push and open the PR
git push -u origin mitch-schneider-1/gstack-portability-check
gh pr create --base main \
  --title "Pre-launch: landing fixes + security hardening" \
  --body "Landing: OG meta, favicon, removed dead GitHub link, WCAG contrast. Hardening: Sentry token scrubber, trimmed unused Slack scopes, npm audit fix, CI workflow, README docs."
```

Then go to the PR on GitHub. The CI check (the new workflow) will run — wait for the green check ✅. When green:

```bash
gh pr merge --squash --delete-branch
```

Wait ~60 seconds. Vercel rebuilds `hunchpredictions.com`. Open it: you should see the
favicon "h" in the tab and no GitHub link in the footer.

---

## STEP 2 — Fix the Railway certificate (10 min) — THE LAUNCH BLOCKER

Right now, every "Add to Slack" click shows a browser security warning. Until this is
fixed, nobody can install Hunch.

1. Go to https://railway.app → log in → open your Hunch project → click the service.
2. Find **Settings → Networking → Custom Domains** (or just "Domains").
3. You'll see `app.hunchpredictions.com`. Its cert status is stuck.
4. Click **Retry** / **Re-verify**. If there's no such button, **delete the domain and
   re-add** `app.hunchpredictions.com`. Wait 1-2 minutes.
5. Test it worked:
   ```bash
   curl -sI https://app.hunchpredictions.com/slack/install | head -3
   ```
   You want `HTTP/2 302` or `200`. You do NOT want `curl: (60) SSL...`.
6. Open `https://app.hunchpredictions.com/slack/install` in a private browser window —
   you should see Slack's permission screen, not a warning.

If still broken after 5 min, message Railway support: "Custom domain
app.hunchpredictions.com is serving the wildcard *.up.railway.app cert instead of a
domain cert. Please re-issue."

---

## STEP 3 — Update the Slack app dashboard (5 min)

I trimmed two unused permissions out of `slack/manifest.json`. For that to take effect
on the live app, re-paste the manifest:

1. Go to https://api.slack.com/apps → click your **Hunch** app.
2. Left sidebar → **App Manifest**.
3. Open `slack/manifest.json` from the repo, copy all of it, paste over what's there.
4. Click **Save Changes**.
5. If it asks to **Reinstall to workspace**, click through (only affects workspaces that
   already have Hunch — probably just your test one).

---

## STEP 4 — Ship the database migration safely (15 min)

⚠️ Do this AFTER Step 1 is merged. This one needs your production database, and the order
matters or it errors.

**4a. Baseline production first.** Your prod DB already has all the tables (from the old
`db push`). You must tell Prisma "treat the current schema as already-migrated" once:

```bash
cd /Users/mitchelschneider/conductor/workspaces/hunch-v1/muscat

# Get your production DATABASE_URL from Railway (Postgres service → Variables → DATABASE_URL)
# Then run, with that URL pasted in:
DATABASE_URL="<paste-prod-database-url>" npx prisma migrate resolve --applied 0_init
```

You should see: `Migration 0_init marked as applied.`

**4b. Now ship the migration branch:**

```bash
git push -u origin mitch-schneider-1/prisma-migrations
gh pr create --base main \
  --title "Switch production to tracked Prisma migrations" \
  --body "Replaces db push --accept-data-loss on boot with migrate deploy. Adds 0_init migration. Production was baselined with prisma migrate resolve --applied 0_init."
gh pr merge --squash --delete-branch
```

When Railway redeploys, it runs `migrate deploy`. Because you baselined in 4a, it sees
0_init as done and does nothing destructive. From now on, schema changes go through real
migrations and can't silently delete data.

> Optional safety: in Railway, take a DB backup (Postgres service → Backups → Create
> backup) before this deploy.

---

## STEP 5 — Verify the whole thing works end to end (15 min)

1. Open `https://hunchpredictions.com` in a private window. Favicon shows, no GitHub link.
2. Click "Add to Slack" → should reach Slack's permission screen (not a warning).
3. Install into a test Slack workspace (make a free one if needed). You should get a
   welcome DM from Hunch.
4. In that workspace, type `/hunch help` → help card appears. Try `/hunch create`,
   make a fake question, commit a hunch, resolve it.
5. Back here, re-run QA: type `/qa https://hunchpredictions.com`. Score should be ~96+.

---

## DECISIONS I LEFT FOR YOU (not bugs — your call)

- **Slack token rotation** — I did NOT enable it. It's the right security upgrade
  long-term, but it's not a simple flag: it makes bot tokens expire, and the code stores
  a token at install time. Enabling it needs a code review of every place the stored
  token is used, plus an overnight test. Worth doing before scaling, not before launch.

- **LICENSE file** — You chose to keep the repo private, so I didn't add one. If you ever
  open-source it, add an MIT license then.

- **Commit author email** — Your commits say `<mitchelschneider@Mac.lan>` because git
  isn't configured with your email. To fix before pushing:
  ```bash
  git config --global user.email "mitchel.schneider1@gmail.com"
  git config --global user.name "Mitchel Schneider"
  ```
  (Only affects future commits. Existing ones are fine to leave.)

---

## What I already did (no action needed — for your reference)

| Done | Where |
|---|---|
| OG/Twitter preview cards | `landing/index.html` |
| Favicon | `landing/favicon.svg` |
| Removed dead GitHub link | `landing/index.html` |
| WCAG contrast fix | `landing/styles.css` |
| Sentry strips Slack tokens before sending | `src/observability/sentry.ts` |
| Removed 2 unused Slack permissions | `slack/manifest.json` |
| Patched production dependency vulns | `package-lock.json` |
| CI runs tests + isolation suite on every PR | `.github/workflows/test.yml` |
| README documents tests + TEST_DATABASE_URL | `README.md` |
| Tracked DB migration + safe Dockerfile | `prisma/migrations/`, `Dockerfile` (migration branch) |

Tests: 35 pass. Typecheck: clean. Build: clean.
