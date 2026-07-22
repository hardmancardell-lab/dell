# Deployment — Vercel

This app has only ever run via local dev server. This doc is the step-by-step for when you're ready to
actually go live — **none of these steps have been executed on your behalf**; deploying and creating the
Supabase project are real, externally-visible actions that need your own accounts and your own explicit
go-ahead, the same way every other real API key/account in this project (Alpaca, Tradier, OANDA, Schwab) was
set up by you and then wired in.

## Prerequisites

- This directory needs to be a git repository with a remote (GitHub/GitLab/Bitbucket) for Vercel's easiest
  "import project" flow. If it isn't a git repo yet, that's a separate first step — check `git status` before
  assuming.
- A Supabase project, if you want real analytics data from day one — see `SUPABASE_INTEGRATION_NOTES.md`. The
  app works fine without it (`/api/track` no-ops until configured), so this can also be done after the first
  deploy.

## Steps

1. Push this repo to GitHub (or your preferred git host) if it isn't already there.
2. At vercel.com, "Add New Project" → import the repo. Vercel auto-detects Next.js — no config changes needed
   (`next.config.ts` is unmodified boilerplate, zero-config deploy).
3. Before the first deploy, add every environment variable from your local `.env.local` into the Vercel
   project's Settings → Environment Variables, **for the Production environment**:
   - `FRED_API_KEY`, `FMP_API_KEY`
   - `SCHWAB_APP_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_REDIRECT_URI` (update the redirect URI to your production
     domain once you have one — Schwab's OAuth flow needs an exact match)
   - `ALPACA_API_KEY_ID`, `ALPACA_SECRET_KEY`
   - `TRADIER_ACCESS_TOKEN`
   - `OANDA_API_TOKEN`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (once you've created the Supabase project)
   - Leave `MARKET_DATA_MOCK_MODE` unset/false for production — this should serve real data.
4. Deploy. Vercel builds with `npm run build` (same command already verified clean locally) and serves via
   `npm run start` under the hood.
5. Once live, verify the deployed app the same way local verification works: load a few tabs, confirm real
   market data renders, confirm the PWA manifest is installable (Chrome DevTools → Application → Manifest on
   the live URL), and — if Supabase is wired up — confirm real `tab_view`/`ticker_analyzed` rows land in the
   `events` table per `SUPABASE_INTEGRATION_NOTES.md`'s checklist.

## What this does NOT cover

A real privacy policy. The on-page footer (`src/components/PrivacyFooter.tsx`) is a plain-language, honest
disclosure of what's collected — it is not a substitute for actual legal review, which is worth getting before
wide public distribution of a financial-data app that collects any usage data at all, even anonymized.
