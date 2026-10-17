# Next.js upgrade notes (not performed)

Written 2026-10-17. Installed: `next` **16.2.10** (also `eslint-config-next` 16.2.10). The upgrade was deliberately NOT done in this batch; this file records what `npm audit` reports, which findings look reachable in this app, and a recommended path.

How the audit was produced: `npm audit --json` run once from the repo root (it sends package metadata to the public npm advisory endpoint; no app code, database or secrets involved). Totals: 1 critical, 12 high, 1 moderate across 14 packages. Re-run it before acting; advisories change daily.

## 1. Advisories against the installed `next` 16.2.10

`npm audit` marks the whole `next` range `9.3.4-canary.0 - 16.3.7` as vulnerable (critical) and offers `next@16.4.2` (reported as NOT a semver-major change) as the fix. Individual advisories, with the fixed-in version taken from the audit ranges:

| Advisory | Severity | Fixed in | Reachable here? |
|---|---|---|---|
| GHSA-6gpp-xcg3-4w24 Middleware / Proxy bypass, App Router, Turbopack and single locale | high | 16.2.11 | **Check first.** `src/middleware.ts` is the site gate, the Supabase session check and the cron Bearer check, and `next build` uses Turbopack by default in Next 16. The app has no `i18n`/locale config, so the "single locale" precondition probably does not apply, but the advisory text must be read against the exact build config before relying on that. Every route also re-checks its own auth (admin cookie, client cookie, Bearer, Twilio signature), which limits the blast radius of a middleware bypass for the admin/cron/webhook surfaces, but NOT for the per-user Supabase routes that rely on middleware alone. |
| GHSA-m99w-x7hq-7vfj DoS in Server Actions; GHSA-4c39-4ccg-62r3 unbounded Server Action payload (Edge); GHSA-89xv-2m56-2m9x SSRF in Server Actions on custom servers; GHSA-955p-x3mx-jcvp disclosure of internal Server Function endpoints | high / moderate | 16.2.11 | Not reachable: the repo has no `"use server"` actions (grep finds only a comment) and no custom server. |
| GHSA-p9j2-gv94-2wf4 SSRF in rewrites via attacker-controlled hostname | high | 16.2.11 | Not reachable: `next.config.ts` defines no rewrites. |
| GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q cache confusion of response bodies for requests with bodies | moderate | 16.2.11 | Low. App Router route handlers with request bodies exist (POST APIs), but responses are dynamic, user-specific JSON; confirm they are not cached by any layer in front (Vercel does not cache POST). |
| GHSA-q8wf-6r8g-63ch DoS in Image Optimization API using SVGs | moderate | 16.2.11 | Low. No `next/image` usage and no `images` config; `/_next/image` still exists by default and is excluded from the middleware matcher. On Vercel image optimization runs on Vercel's infrastructure, not this app's functions. Consider `images: { unoptimized: true }` until upgraded. |
| GHSA-p293-qw3h-jr36 unauthenticated RCE on Windows-hosted servers | critical | 16.3.3 | Not reachable: production is Vercel (Linux). Matters for local Windows dev only if the dev server is exposed beyond localhost. |
| GHSA-2xp9-vwfh-vxw4 RCE in Image Optimization API with AVIF files | critical | 16.3.3 | Low on Vercel (image optimizer is Vercel-hosted); do not self-host this build until upgraded. |
| GHSA-vcvr-r3jv-pc5j RCE in `next/og` ImageResponse | critical | 16.3.6 | Not reachable: no `ImageResponse` / `next/og` use in `src/`. |
| GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p cache poisoning of SSG/ISR pages (self-hosted) | moderate | 16.3.8 | Not reachable: Vercel hosted; pages are not ISR. |
| GHSA-39w2-rjm5-chcv dev-server MCP endpoint information disclosure | low | 16.3.8 | Dev only; do not run `next dev` on a shared network. |
| GHSA-f87g-xv8r-7p7x metadata image routes `dynamicParams` bypass | moderate | 16.3.8 | Unlikely: only static `icon.png`/`apple-icon.png`, no dynamic metadata image routes. |
| GHSA-cjq9-62q9-8jv4 SSRF in Image Optimization | high | 16.3.8 | Low for the same reason as the other image findings (no remote image patterns configured, Vercel-hosted optimizer). |

Transitive packages bundled by `next` (fix arrives with the upgrade, `fixAvailable: next@16.4.2`): `postcss` (path traversal / source-map file read, high; only matters if untrusted CSS is processed at build time, which is not the case), `sharp` (libvips/libheif/librsvg CVEs, high; only used by image optimization, see above).

## 2. Findings outside `next` (dev tooling, fixable without touching the framework)

- `eslint-config-next` 16.2.10 pulls `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch` -> `braces` (high, stack-exhaustion DoS in glob patterns). Dev-time only. `npm audit` proposes downgrading to `eslint-config-next@14.2.35`, which is NOT acceptable; instead wait for the upgrade or use `npm audit fix` for the pieces that offer a safe fix.
- `brace-expansion`, `browserslist`, `js-yaml`, `nanoid`, `source-map-js`, `baseline-browser-mapping`: `fixAvailable: true` (a plain `npm audit fix` updates them within their semver ranges). All are build/dev-time ReDoS/DoS style issues, not request-time in production.

## 3. Recommended target and order

1. Target **`next@16.4.2`** (what `npm audit` itself recommends, non-major) together with a matching `eslint-config-next@16.4.2`, `react`/`react-dom` only if the new Next peer range requires it. If a later 16.4.x exists when this is done, take the newest patch of the 16.4 line (16.3.8 is the first version that clears every advisory above, so anything >= 16.3.8 satisfies the audit; 16.4.2 is the audit's pick).
2. First `npm audit fix` (no `--force`) in its own commit for the `fixAvailable: true` dev packages; run the full test list below.
3. Then the `next` bump in a branch, and `npm run build` plus `npx tsc --noEmit` and `npx eslint`.
4. Read the Next 16.2 -> 16.4 release notes for: middleware/proxy naming (Next 16 deprecates `middleware.ts` in favour of `proxy.ts`; the audit already flagged this, decide in the same change and re-run the access test), Turbopack defaults, and any change to the `cookies()`/`headers()` async APIs the admin and API routes use.
5. Deploy to a Vercel Preview first (never straight to production) and run the smoke list below against the Preview URL.

## 4. Test plan

Automated (all offline, `node --import ./scripts/ts-loader/register.mjs scripts/<name>.test.mts`; note they import `next/server` from `node_modules`, so they exercise the NEW Next version after the bump):

- `access-middleware.test.mts` (75 cases: gate on/off, cron Bearer, Twilio, JSON 401, path tricks, cookie tokens, lockouts). This is the primary guard for the middleware-bypass advisory; if any "path tricks" row changes decision after the bump, stop.
- `journal-filter-injection.test.mts`, `paper-order-engine.test.mts`, `crypto-paper-trading.test.mts`, `assistant-conformance.test.mts`, `faye-widget-guards.test.mts`, `option-flow-cron-route.test.mts`, plus the pre-existing market/stat tests.
- `npx tsc --noEmit`, `npx eslint`, `npm run build`.

Manual smoke on the Preview deployment (needs a human; none of this was run):

1. Signed out: `/` redirects to `/gate` (when `SITE_ACCESS_PASSWORD` is set) then `/login`; `/api/journal` returns JSON 401, not HTML.
2. `/api/cron/check-alerts` with and without `Authorization: Bearer <CRON_SECRET>`: 200 vs 401. Trigger the GitHub workflow once with `workflow_dispatch`.
3. `/api/sms-webhook` unsigned POST returns 403 when `TWILIO_AUTH_TOKEN` is set; a Twilio console test message returns 200.
4. Admin login/logout, "view as" a client, client portal passcode flow (cookie format changed in this batch, so everyone logs in once).
5. Assistant: one chat turn with a tool call, and the typed "yes" confirmation for feedback.
6. Paper trading: one market buy, one resting limit order, "Check Orders".
7. Static assets: `/sw.js`, `/manifest.webmanifest`, `/videos/...` still bypass the middleware matcher.

Rollback: keep the previous deployment promoted-able in Vercel; the change is a lockfile bump only.

## 5. What was NOT done and why

No Next.js upgrade (explicit instruction). `npm audit fix` was not run either, to keep this batch's diff to the audited fixes. The advisory texts above are summarised from `npm audit` titles and version ranges only; the upstream GitHub advisories were not read in full, so reachability judgements marked "probably" or "low" should be confirmed against them before closing the items.
