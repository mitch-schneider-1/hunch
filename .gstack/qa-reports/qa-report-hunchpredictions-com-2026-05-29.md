# QA Report — hunchpredictions.com

**PR-ready summary:** /qa found 5 issues, fixed 2 in `landing/` (1 commit each), deferred 3 needing infra/content decisions. Health score 91.9 → 93.05. **Blocker:** the "Add to Slack" CTA is broken in every browser due to a TLS cert mismatch on `app.hunchpredictions.com` — fix in Railway custom-domain settings before launch.

---

## Metadata

| Field | Value |
|---|---|
| Date | 2026-05-29 |
| Tier | Standard |
| Mode | Full (branch was clean — no diff-aware scope) |
| Target | `https://hunchpredictions.com` (Vercel) + `https://app.hunchpredictions.com` (Railway) |
| Framework | Static HTML (4.2KB) |
| Branch | `mitch-schneider-1/muscat` |
| Pages visited | 1 landing page (desktop + mobile) + 1 external CTA target |
| Screenshots | 4 in `.gstack/qa-reports/screenshots/` |
| Duration | ~10 min |
| Console errors | 0 |

---

## Top 3 things to fix

1. **ISSUE-001 (CRITICAL)** — Fix the TLS cert on `app.hunchpredictions.com`. **Every install attempt is being blocked by browsers right now.** This is more important than every other landing-page polish item combined.
2. **ISSUE-003 (MEDIUM)** — Decide on the GitHub footer link: either flip the repo to public (one click in repo Settings) or remove the line from `landing/index.html`. As of today, every visitor who clicks "Source on GitHub" sees a 404.
3. **(Follow-up)** — Add an `og:image` and `twitter:image` to the meta tags shipped in ISSUE-002. Cards will render with text only until an image is provided; a 1200×630 social card would noticeably lift CTR from Slack/X shares.

---

## Summary table

| ID | Severity | Title | Status | Commit |
|---|---|---|---|---|
| ISSUE-001 | CRITICAL | TLS cert mismatch on `app.hunchpredictions.com` blocks "Add to Slack" CTA | DEFERRED (infra) | — |
| ISSUE-002 | HIGH | No OG/Twitter meta → bare URL previews when shared | VERIFIED (local) / BEST-EFFORT (prod-unverified) | `697bdb9` |
| ISSUE-003 | MEDIUM | Footer "Source on GitHub" link returns 404 (repo is private) | DEFERRED (content decision) | — |
| ISSUE-004 | MEDIUM | No favicon (`/favicon.ico` 404) | VERIFIED (local) / BEST-EFFORT (prod-unverified) | `cb6f136` |
| ISSUE-005 | LOW | `<h1>` contrast 1.94:1 fails WCAG large-text 3:1 | DEFERRED (intentional design) | — |

---

## Health score

### Baseline

| Category | Weight | Score | Deductions |
|---|---|---|---|
| Console | 15% | 100 | (no errors) |
| Links | 10% | 85 | ISSUE-003 (medium, -15) |
| Visual | 10% | 100 | (no issues) |
| Functional | 20% | 75 | ISSUE-001 (critical, -25) |
| UX | 15% | 100 | (no issues) |
| Performance | 10% | 100 | (not measured; static 4KB on Vercel CDN, HTTP/2, HSTS preload) |
| Content | 5% | 77 | ISSUE-002 (high, -15) + ISSUE-004 (medium, -8) |
| Accessibility | 15% | 97 | ISSUE-005 (low, -3) |

**Weighted: 91.9**

### After fixes

| Category | Weight | Score | Notes |
|---|---|---|---|
| Console | 15% | 100 | unchanged |
| Links | 10% | 85 | ISSUE-003 still open |
| Visual | 10% | 100 | unchanged |
| Functional | 20% | 75 | ISSUE-001 still open |
| UX | 15% | 100 | unchanged |
| Performance | 10% | 100 | unchanged |
| Content | 5% | 100 | ISSUE-002 + ISSUE-004 resolved |
| Accessibility | 15% | 97 | ISSUE-005 still open |

**Weighted: 93.05** (+1.15)

> The score under-represents impact. ISSUE-002 (OG/Twitter meta) lives in Content (5% weight), but its real value is on the distribution funnel — every Slack/X/LinkedIn share now renders a real preview card rather than a bare URL. Score deltas don't capture marketing reach.

---

## Issues

### ISSUE-001 — TLS cert mismatch on `app.hunchpredictions.com`

**Severity:** CRITICAL
**Category:** Functional / Infrastructure
**Status:** DEFERRED — not fixable in this repo

**What happens.** The landing-page CTA links to `https://app.hunchpredictions.com/slack/install`. The Railway-served subdomain presents a TLS cert with CN `*.up.railway.app` and no `subjectAltName` covering `app.hunchpredictions.com`. Every modern browser (Chrome, Safari, Firefox, Edge) hard-blocks the page with `ERR_CERT_COMMON_NAME_INVALID`. Users see a security warning and bail.

**Repro.**
```bash
curl -sIv https://app.hunchpredictions.com/slack/install 2>&1 | grep -E '(subject|subjectAlt|SSL)'
# subject: CN=*.up.railway.app
# subjectAltName does not match host name app.hunchpredictions.com
# SSL: no alternative certificate subject name matches target host name
```

In-browser repro: `goto https://app.hunchpredictions.com/slack/install` → `net::ERR_CERT_COMMON_NAME_INVALID` → blank page. Screenshot: `.gstack/qa-reports/screenshots/install-link-result.png`.

**DNS:** `app.hunchpredictions.com → f1kqzdsp.up.railway.app → 66.33.22.181`. DNS routing works; the cert provisioning for the custom domain on Railway hasn't completed.

**Fix.** In Railway: project → service → Settings → Custom Domains → re-verify `app.hunchpredictions.com` and trigger a Let's Encrypt cert issuance. Railway usually auto-provisions once the DNS CNAME is verified, but this one is stuck. If Railway can't issue, options are Cloudflare in front (flexible TLS) or moving the OAuth callback host.

**Why deferred:** outside repo scope. Cannot be fixed by changing files in this branch.

---

### ISSUE-002 — No Open Graph / Twitter Card meta (shared URLs render bare)

**Severity:** HIGH
**Category:** Content / Distribution
**Status:** VERIFIED locally, BEST-EFFORT on production (deploys required to confirm)

**What was wrong.** `landing/index.html` had only `<title>` and `<meta name="description">`. When the URL was pasted into Slack, X, or LinkedIn, no preview card rendered. For a tool whose primary distribution channel is Slack channels, that's a meaningful drag on viral coefficient.

**Fix applied** (commit `697bdb9`): added in `<head>`:

```html
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Hunch" />
<meta property="og:title" content="Hunch — anonymous prediction markets for your team" />
<meta property="og:description" content="A Slack bot for thoughtful, anonymous forecasting. Ask a question, your team weighs in, the aggregate stays hidden until resolution." />
<meta property="og:url" content="https://hunchpredictions.com/" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="..." />
<meta name="twitter:description" content="..." />
```

**Verification.**
- Local DOM check (after `python3 -m http.server`): `og:title`, `og:description` (132 chars), `twitter:card="summary"` all present.
- Visual regression: identical to baseline — meta tags don't affect layout.

**Deferred follow-up.** `og:image` and `twitter:image` were intentionally omitted (no marketing asset yet). Platforms still render a text card with title + description, but a 1200×630 image would noticeably improve CTR. Recommend generating one.

---

### ISSUE-003 — Footer "Source on GitHub" link returns 404

**Severity:** MEDIUM
**Category:** Links / Trust
**Status:** DEFERRED — content/brand decision

**What's wrong.** `landing/index.html:67` points to `https://github.com/mitch-schneider-1/hunch`. The repo exists but is **private** (`gh repo view mitch-schneider-1/hunch` confirms `visibility: PRIVATE`). Unauthenticated visitors get a 404. The footer reads "Source on GitHub" — which is a trust signal that doesn't deliver.

**Repro.** Open `https://hunchpredictions.com/` in a private window → click "GitHub" in footer → 404 page.

**Two paths (your call).**
1. Flip the repo to public — Settings → "Change visibility" → Public. README is already written for public consumption (it talks about self-hosting forks). One click, and the link starts working.
2. Remove the link from the footer until the repo is ready to publish. Minimal HTML edit.

**Why deferred:** I won't silently remove a "Source on GitHub" line from your landing page — that's a brand/positioning decision. Tell me which path and I can ship it.

---

### ISSUE-004 — No favicon

**Severity:** MEDIUM
**Category:** Content / Polish
**Status:** VERIFIED locally, BEST-EFFORT on production

**What was wrong.** `https://hunchpredictions.com/favicon.ico` returned `HTTP 404` from Vercel. Browsers fell back to a default globe icon in tabs and bookmarks. For a B2B SaaS landing page being shared into Slack channels, no favicon reads as unfinished.

**Fix applied** (commit `cb6f136`): added `landing/favicon.svg` (minimal "h" wordmark in #111 on #fff) and linked it via `<link rel="icon" type="image/svg+xml" href="favicon.svg" />`. SVG favicons are supported by all modern browsers (Chrome 80+, Safari 13+, Firefox 41+).

**Verification.** Local server returns `HTTP 200 | content-type: image/svg+xml`. DOM contains `link[rel="icon"]` with href resolving correctly.

---

### ISSUE-005 — `<h1>` contrast fails WCAG

**Severity:** LOW
**Category:** Accessibility
**Status:** DEFERRED — intentional minimalist design

**What's wrong.** `landing/styles.css:35-41` sets `h1 { color: #c9c9c9 }`. Measured contrast vs `#fff` background = **1.94:1**. WCAG 2.1 AA requires **3:1 for large text** (h1 at 28px bold qualifies). Fails.

**Why deferred.** The faded wordmark is a clear stylistic choice — the tagline below carries full-contrast (`#111 on #fff`) and effectively serves as the page's reading-priority title. Low-vision users still get the message. This is the kind of intentional brand call I won't override silently.

**If you want to fix:** raise the h1 to at least `#bababa` (3:1) or `#767676` (4.5:1). Or wrap the wordmark in a `<span role="presentation" aria-label="Hunch">` and add a visually hidden full-contrast heading.

---

## Walkthrough notes (positive findings)

- **No console errors** at any point during desktop + mobile testing.
- **Mobile layout (375×812)**: clean single-column stack, generous spacing, text readable. The `@media (max-width: 640px)` rule in `styles.css:190-201` is doing real work — both `.grid` and `.steps` collapse to single column correctly.
- **Vercel hosting**: HTTP/2, HSTS preload (`max-age=63072000`), cache-control wired. No mixed-content risk.
- **Twitter link** (`@mitch_schneider`) and **mailto** both work as expected.
- **Body copy** is tight. The "What/Why/How" structure is well-paced. No typos, no broken markup, no overflow.
- **HTML semantics** are right: one `<h1>`, sections labeled, `<ol class="steps">` for ordered steps, `aria-hidden="true"` on the decorative Slack SVG. Good baseline a11y.

---

## Self-regulation log

- 2 fixes applied, 0 reverts, both within `landing/`.
- WTF-likelihood: well below 20%. No abort needed.
- Hard cap of 50 fixes not approached.

---

## Verification

- `git log main..HEAD --oneline` shows two `fix(qa):` commits.
- Each commit touches only files in `landing/` (no scope creep into `src/`, `prisma/`, `tests/`).
- Local re-render screenshot (`after-fixes-local.png`) is visually identical to baseline — fixes are purely `<head>`-level additions.

## Risks / open items

- **ISSUE-001 must be fixed before any meaningful launch push.** Driving traffic to a landing page whose CTA hits a browser security warning is worse than not driving traffic at all.
- ISSUE-002 + ISSUE-004 are committed but unverified on production. They take effect on the next Vercel deploy of this branch (or after a merge to main, depending on the deploy config).
- `git config user.email`/`user.name` are unset locally — commits are authored by `Mitchel Schneider <mitchelschneider@Mac.lan>`. Optional cleanup: set them explicitly to match the GitHub email.
