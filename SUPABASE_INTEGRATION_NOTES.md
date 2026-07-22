# Supabase Integration — What's Unverified Until You Create the Project

Companion to `ALPACA_INTEGRATION_NOTES.md`, `TRADIER_INTEGRATION_NOTES.md`, `OANDA_INTEGRATION_NOTES.md`, and
`SCHWAB_INTEGRATION_NOTES.md` — same format. The client is `src/lib/analytics/supabase.ts` (a plain-fetch
REST insert against Supabase's PostgREST API, no SDK, matching every other data-provider client in this app).
This is the **first** piece of backend infrastructure this project has ever had — everything before this was
either a read-only third-party market-data API or client-side `localStorage`.

## What this is for

Anonymous, privacy-scoped usage analytics — feature/tab navigation and which tickers get analyzed — so a data
analyst can query real usage once the app is shared. Never: account info, portfolio holdings, dollar amounts,
or anything else typed into the app. See `src/components/PrivacyFooter.tsx` for the exact on-page disclosure
and `src/lib/analytics/use-track.ts` for what a `track()` call can carry.

## One-time setup

1. Create a free Supabase project at supabase.com.
2. In the SQL editor, run:
   ```sql
   create table events (
     id uuid primary key default gen_random_uuid(),
     session_id text not null,
     event_name text not null,
     agent text,
     tab text,
     symbol text,
     metadata jsonb,
     created_at timestamptz not null default now()
   );
   ```
3. Project Settings → API: copy the Project URL into `SUPABASE_URL`, and the **service_role** key (not the
   anon/public key — this is a server-only write path, never exposed to the client) into
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
4. Restart the dev server (env vars only read at Next.js startup, same as every other provider key in this app).

## Second table: `feedback` (Assistant's suggestion/problem capture)

Same project, same env vars — no new setup beyond running this second `create table`. The Assistant's
`submit_feedback` tool (`src/lib/agents/assistant/tools.ts`, client `src/lib/analytics/feedback.ts`) calls this
whenever a user offers a suggestion or reports a problem in the chat.

```sql
create table feedback (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  category text not null,       -- 'suggestion' | 'problem' | 'other'
  message text not null,
  context_tab text,
  created_at timestamptz not null default now()
);
```

Verify: type "I have a suggestion: dark mode please" into the Assistant chat, confirm a row lands in `feedback`
with `category = 'suggestion'` and the real message text. With Supabase unset, `submitFeedback()` returns
`{stored: false}` instead of throwing — the assistant tells the user honestly that feedback capture isn't set
up yet, rather than pretending it saved.

## Checklist — verify these once real keys are set

1. **`/api/track` actually inserts a row.** → *How to check:* click through a few tabs in the app, then check
   the `events` table in Supabase's own table editor for `event_name = "tab_view"` rows with a real `session_id`.
2. **`ticker_analyzed` events carry the right symbol.** → *How to check:* submit a ticker in Analyze Ticker,
   Charts, or the Screener's "+ Save", confirm a row with `event_name = "ticker_analyzed"` and the matching
   `symbol` appears.
3. **No financial data ever lands in the table.** → *How to check:* directly inspect the `events` table after
   using the Portfolio Tracker — confirm no dollar amounts, share counts, or holdings appear anywhere (the
   tracker only wires `tab_view`/`ticker_analyzed`, never anything from portfolio state).
4. **Failure is silent.** → *How to check:* with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` blank (the default,
   pre-setup state), confirm `/api/track` returns `204` and the app behaves identically — no console errors, no
   broken UI.

## How to re-test with mock data anytime

Leave `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` blank — `isSupabaseConfigured()` short-circuits `/api/track` to
a no-op `204` before ever calling Supabase, so the rest of the app is unaffected either way.
