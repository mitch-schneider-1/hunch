# QA Regression Report — hunchpredictions.com (live)

**PR-ready summary:** Regression QA on the live production site. Health score **91.9 → 99.6**. All 5 baseline issues resolved or intentionally deferred; 0 new issues; install flow + TLS confirmed working end-to-end.

## Metadata

| Field | Value |
|---|---|
| Date | 2026-05-29 (regression run) |
| Tier | Standard |
| Mode | Regression (vs `baseline.json`, 2026-05-29) |
| Target | `https://hunchpredictions.com` (live, Vercel) + `https://app.hunchpredictions.com/slack/install` (live, Railway) |
| Framework | Static HTML |
| Pages | landing (desktop + mobile) + install-flow redirect |
| Console errors | 0 |

## Regression vs baseline

| ID | Severity | Baseline status | **Now** | Evidence |
|---|---|---|---|---|
| ISSUE-001 | Critical | deferred (TLS cert mismatch) | ✅ **RESOLVED** | cert `subjectAltName` matches `app.hunchpredictions.com`; install → HTTP 200 to Slack OAuth |
| ISSUE-002 | High | verified (not deployed) | ✅ **LIVE** | `og:title` present, `twitter:card=summary` |
| ISSUE-003 | Medium | deferred (GitHub 404) | ✅ **RESOLVED** | 0 github links in DOM; footer reads "Built by … Questions: …" |
| ISSUE-004 | Medium | verified (not deployed) | ✅ **LIVE** | `favicon.svg` loads (HTTP 200, 343B) |
| ISSUE-006 | Low | fixed (not deployed) | ✅ **LIVE** | `--muted: #717171`; all body text passes WCAG AA |
| ISSUE-005 | Low | deferred (h1 contrast 1.66:1) | ⏸️ **Deferred (intentional)** | still 1.66:1 — the faded "hunch" wordmark is a deliberate brand mark |

**Issues fixed since baseline:** 5 (001, 002, 003, 004, 006)
**New issues this run:** 0
**Still deferred (by design):** 1 (005 — intentional low-contrast wordmark)

## Health score

| Category | Weight | Baseline | **Now** |
|---|---|---|---|
| Console | 15% | 100 | 100 |
| Links | 10% | 85 | **100** (broken GitHub link removed) |
| Visual | 10% | 100 | 100 |
| Functional | 20% | 75 | **100** (install flow + TLS working) |
| UX | 15% | 100 | 100 |
| Performance | 10% | 100 | 100 (62ms TTFB, ~8KB, HTTP/2) |
| Content | 5% | 77 | **100** (favicon + OG live) |
| Accessibility | 15% | 97 | 97 (only the intentional h1 wordmark) |

**Weighted: 91.9 → 99.6** (+7.7)

The remaining 0.4 is entirely the deliberately-faded h1 wordmark. There are no real defects on the live site.

## Install flow (end-to-end)

- `https://app.hunchpredictions.com/slack/install` → **HTTP 200**, redirects to `https://slack.com/oauth/v2/authorize` with the correct 7 scopes, valid `state`, and the right `redirect_uri`.
- TLS cert valid for the custom domain (no browser warning).
- **Not testable from here:** behavior *inside* Slack after install (welcome DM, `/hunch create`, resolve). Requires a real workspace — only you can drive that. See manual test in the wrap-up.

## Verdict

**Ship-ready.** The live site is clean: no console errors, no broken links, working install funnel, valid cert, fast load, accessible body text. The only non-100 line is an intentional design choice. No fixes were needed this run (Standard tier doesn't touch the one remaining low/intentional item).
