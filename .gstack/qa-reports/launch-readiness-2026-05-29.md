# Hunch — launch readiness report

**Date:** 2026-05-29
**Branch:** `mitch-schneider-1/gstack-portability-check` (renamed from `mitch-schneider-1/muscat` mid-session — same commit lineage)
**Target:** `origin/main`

## TL;DR

4 atomic fix commits on the branch, all in `landing/`. Tests green, typecheck green, diff clean. **The branch is ready to push.**

Three real blockers stand between this and "shippable to other people":
1. **Railway TLS cert** on `app.hunchpredictions.com` is invalid → every "Add to Slack" click hits a browser security warning. Infra fix, not code.
2. **README lies about migrations** → Dockerfile silently runs `db push --accept-data-loss` on every boot. Real data-loss risk if schema ever changes.
3. **No CI** → the multi-tenant trust-boundary test only runs with `TEST_DATABASE_URL` and that's never set anywhere automated. The most important test in the suite gates nothing.

Plus three should-fix-before-launch items: bot tokens stored plaintext, no LICENSE file, Slack manifest over-requests scopes.

## What I committed (4 atomic commits)

| Commit | Fix | Files |
|---|---|---|
| `697bdb9` | ISSUE-002 — Open Graph + Twitter Card meta (preview cards when shared) | `landing/index.html` |
| `cb6f136` | ISSUE-004 — SVG favicon | `landing/favicon.svg`, `landing/index.html` |
| `738e36d` | ISSUE-003 — remove broken `Source on GitHub` link (repo is private) | `landing/index.html` |
| `af7d771` | ISSUE-006 — bump `--muted` from `#888` to `#717171` (WCAG AA) | `landing/styles.css` |

Total diff vs `main`: **3 files, 19 insertions, 2 deletions.** All in `landing/`. No src changes, no schema changes, no deps changes.

Working tree is clean except for `.gitignore` (a gstack hook auto-added `.gstack/`; not mine to commit — your call).

## What I did NOT auto-fix (and why)

Each of these is a real issue I deliberately surfaced rather than committed, because they touch auth/secrets/schema/product behavior or are judgment calls:

### Critical blockers

**🔴 ISSUE-001 — Railway TLS cert mismatch (carried from earlier /qa)**
- `https://app.hunchpredictions.com/slack/install` serves a cert for `*.up.railway.app` with no SAN for the custom domain.
- Every browser hard-blocks the page with `ERR_CERT_COMMON_NAME_INVALID`.
- **Without this fix, every install attempt fails.** Nothing else matters until this is resolved.
- Fix: Railway → Settings → Custom Domains → re-verify `app.hunchpredictions.com` → trigger Let's Encrypt issuance.

**🔴 README lies about migrations**
- README line 80: "It runs `prisma migrate deploy` on boot."
- Dockerfile reality (line 23): `CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/src/index.js"]`
- No `prisma/migrations/` directory exists — `db push` is your migration story today.
- `--accept-data-loss` means: "if a column was dropped in schema, drop it in DB." Schema drift can silently lose tenant data.
- Two options:
  - **(safer)** Add an initial migration: `npx prisma migrate dev --name init` → update Dockerfile to `npx prisma migrate deploy && node dist/src/index.js`. README becomes truthful, deploys become idempotent and safe.
  - **(documented current behavior)** Update README to say "schema is applied via `prisma db push` on boot; no migrations are tracked. Schema changes can lose data — re-deploy with a fresh DB or write the migration by hand." Honest but worse.

**🔴 No CI — multi-tenancy tests never run automatically**
- `tests/multitenancy.test.ts` is gated on `TEST_DATABASE_URL`. Locally it skips. There's no `.github/workflows/`, no GitLab CI, nothing.
- The test that verifies cross-tenant queries return zero rows — the single test that protects the trust boundary — is verified manually or not at all.
- Fix: add `.github/workflows/test.yml` that stands up a Postgres service container, sets `TEST_DATABASE_URL`, runs `npm test` + `npm run typecheck` on every PR. This is the single highest-leverage CI workflow this repo can have.

### Should-fix before exposing to real workspaces

**🟡 Bot tokens stored plaintext in Postgres** (`Workspace.botToken` column)
- If the DB is ever compromised (Supabase credential leak, Railway misconfig, etc.), every tenant bot token leaks.
- Mitigations (in order of effort):
  - Enable Slack token rotation: set `token_rotation_enabled: true` in `slack/manifest.json` (currently `false`). Tokens auto-expire and rotate — significantly limits blast radius of a leak.
  - Envelope encryption at the column level using a KMS-managed key. Real work but the right long-term answer.

**🟡 Sentry has no `beforeSend` token scrubber**
- `src/index.ts:24` does `app.error(async (err) => { captureError(err); })`. If Bolt ever attaches a token to an error (e.g., as part of a logging context), it ships to Sentry.
- Fix: in `src/observability/sentry.ts`, add a `beforeSend` callback that walks the event payload and replaces any string matching `/xox[abp]-[\w-]+/` with `[REDACTED]`.

**🟡 8 npm dependency vulnerabilities** (6 moderate, 1 high, 1 critical)
- `npm audit fix` resolves most without breaking changes. The critical one needs `--force` and may break.
- Worth doing as a separate PR before launch. Run `npm audit fix --dry-run` first to see the diff.

**🟡 Slack manifest over-permissions**
- `slack/manifest.json` declares 9 bot scopes; `src/slack/app.ts` requests 7 at runtime. The extras (`team:read`, `users:read.email`) are unused.
- Runtime scopes are what's actually consented at install time, so the *user impact* is zero. But it's principle-of-least-privilege noise and may flag in a Slack app review.
- Fix: remove the two unused scopes from `slack/manifest.json` → manifest matches reality.

**🟡 No LICENSE file**
- README invites forks/contributors. Without a LICENSE, "open source" doesn't legally hold and forks are technically infringement.
- The repo is currently private. If you publish, decide license then (MIT is the safe default for a tool like this).

### Nice-to-have

**🔵 No CHANGELOG, no CONTRIBUTING.md** — Standard contributor-friendly files. Not blocking.

**🔵 README env-var section is incomplete** — Doesn't mention `TEST_DATABASE_URL` (used by the multi-tenancy tests) or `npm run typecheck`. Forkers won't know to set or run these.

**🔵 Mobile footer tap targets** — 17px tall (below WCAG 2.1 AA recommendation of 24px). Inline text links; expected tradeoff for a minimal footer. Not worth changing unless you get feedback.

**🔵 H1 wordmark contrast** (carried from earlier /qa) — `#c9c9c9` on white = 1.66:1, fails WCAG large-text 3:1. Intentional brand mark; you chose to defer.

## Health-score delta

Carrying baseline from earlier /qa (91.9):

| Category | Before | After 4 commits | Notes |
|---|---|---|---|
| Console | 100 | 100 | unchanged |
| Links | 85 | **100** | ISSUE-003 fixed (broken footer link removed) |
| Visual | 100 | 100 | unchanged |
| Functional | 75 | 75 | ISSUE-001 (Railway TLS) still open |
| UX | 100 | 100 | unchanged |
| Performance | 100 | 100 | 4.2 KB HTML + 3.0 KB CSS + 79 B favicon; 64 ms TTFB |
| Content | 77 | **100** | ISSUE-002 + ISSUE-004 fixed (OG meta + favicon) |
| Accessibility | 97 | **100*** | ISSUE-006 fixed (muted color). *H1 still fails large-text 3:1 but you accepted that as a stylistic choice. |

**Final weighted score: ~96** (up from 91.9). Functional category will jump to 100 the moment Railway TLS is fixed.

## Tests + typecheck

```
$ npm test
✓ tests/market.test.ts  (35 tests)        — LMSR math + anonymity invariants
↓ tests/multitenancy.test.ts (7 skipped)  — gated on TEST_DATABASE_URL

35 passed | 7 skipped (42)

$ npm run typecheck
(no output, exit 0)
```

Tests pass. Typecheck clean. Multi-tenancy tests skip locally without a DB — that's the design, but see "No CI" above.

## What's left to do — in order

### Today (before pushing this branch)

1. **You: push the 4 commits and open the PR.** I stopped before `/ship` per your instruction. PR description draft below.
2. **You: decide on the `.gitignore` modification** that a gstack hook left in your working tree. Either commit it as `chore: gitignore .gstack/ artifacts` or `git checkout -- .gitignore` to drop it.

### Before launching to real Slack workspaces (priority order)

3. **Fix Railway TLS.** Without this, nothing else matters.
4. **Add initial Prisma migration + update Dockerfile.** Or rewrite README to match reality. Pick one.
5. **Add `.github/workflows/test.yml`** with a Postgres service container so multi-tenancy tests gate every PR.
6. **`npm audit fix`** for the 8 dep vulns. Separate PR, easy review.
7. **Add Sentry `beforeSend` token scrubber.** Quick patch, real protection.
8. **Enable Slack token rotation** (`token_rotation_enabled: true` in manifest). Quick win on bot-token-leak blast radius.

### Nice-to-have

9. Trim 2 unused scopes from `slack/manifest.json`.
10. Add `LICENSE` (probably MIT), `CHANGELOG.md`, `CONTRIBUTING.md`.
11. Patch README env section (`TEST_DATABASE_URL`, `typecheck` command).

## PR description draft (for `gh pr create`)

```markdown
## Summary

Pre-launch landing-page polish surfaced by `/qa` and follow-up audits. All 4 commits scoped to `landing/`. No src, schema, deps, or behavior changes.

- ISSUE-002 — Add Open Graph + Twitter Card meta so shared URLs render a preview card in Slack/X/LinkedIn instead of a bare link
- ISSUE-003 — Remove footer "Source on GitHub" link (repo is private; was 404ing for every visitor)
- ISSUE-004 — Add a minimal SVG favicon (browsers were getting a 404 on `/favicon.ico`)
- ISSUE-006 — Raise `--muted` from `#888` to `#717171` so section labels, step numbers, footer text, and install note pass WCAG AA contrast

## Diff stat

3 files, 19 insertions, 2 deletions, all in `landing/`.

## Verification

- `npm test` → 35 passed, 7 multitenancy tests skipped (gated on `TEST_DATABASE_URL`)
- `npm run typecheck` → clean
- Local browser re-render → visually identical to baseline; contrast scan confirms only the deferred h1 wordmark remains
- Production reachable, HTTP/2, HSTS preload; favicon and OG meta will take effect on next Vercel deploy

## What this PR does NOT include (surfaced separately)

- Railway TLS cert mismatch on `app.hunchpredictions.com` (infra, blocks install)
- Prisma migration story (README claims `migrate deploy`, Dockerfile runs `db push --accept-data-loss`)
- No CI — multi-tenancy tests never run automatically
- 8 npm vulns (`npm audit fix` resolves most non-breakingly)
- Bot tokens stored plaintext; no Sentry token scrubber; manifest over-permissions
- No LICENSE / CHANGELOG / CONTRIBUTING

See `.gstack/qa-reports/launch-readiness-2026-05-29.md` for the full report.

## Test plan

- [ ] After merge, Vercel rebuild deploys the 4 changes
- [ ] Verify favicon appears in tab on hunchpredictions.com
- [ ] Paste the URL into Slack/X to confirm preview card renders
- [ ] Verify footer no longer has a GitHub link
- [ ] Visually skim contrast (muted text slightly darker; still minimalist)
- [ ] Re-run /qa or /qa-only to verify health score moved
```

## Commands you'd run

```bash
# 1. Commit (or drop) the .gitignore change
git add .gitignore && git commit -m "chore: gitignore .gstack/ artifacts"
# OR
git checkout -- .gitignore

# 2. Push and open the PR
git push -u origin mitch-schneider-1/gstack-portability-check
gh pr create --base main --title "Pre-launch landing polish (OG meta, favicon, GitHub link, WCAG contrast)" --body-file <(cat <<'EOF'
[paste PR description from above]
EOF
)

# 3. After Vercel deploys, re-run /qa to verify
# Then fix Railway TLS in the Railway console
# Then add the .github/workflows/test.yml file
```

## Identity caveat

The 4 commits are authored by `Mitchel Schneider <mitchelschneider@Mac.lan>` because git's `user.email` isn't set globally. If you'd rather they show your GitHub-linked email, run before pushing:

```bash
git config --global user.email "you@example.com"  # the email tied to your GH account
git rebase -i main --exec 'git commit --amend --reset-author --no-edit'
```

## Artifacts produced this session

- `.context/qa-launch-plan.md` — the plan I followed
- `.gstack/qa-reports/qa-report-hunchpredictions-com-2026-05-29.md` — earlier /qa report
- `.gstack/qa-reports/launch-readiness-2026-05-29.md` — this report
- `.gstack/qa-reports/baseline.json` — for future regression runs
- `.gstack/qa-reports/screenshots/` — 5 PNGs (initial desktop, initial mobile, install-link block, after-fixes local, after-contrast-fix desktop)

## Branch rename note

Mid-session, the branch was externally renamed from `mitch-schneider-1/muscat` → `mitch-schneider-1/gstack-portability-check`. Same commit chain. I didn't rename it. If that name doesn't match what you wanted, `git branch -m <new-name>` before pushing.
