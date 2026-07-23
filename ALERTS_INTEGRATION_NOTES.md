# Push Alerts (Email/SMS) Integration — What's Unverified Until You Sign Up

Companion to `SUPABASE_INTEGRATION_NOTES.md`, `ALPACA_INTEGRATION_NOTES.md`, `TRADIER_INTEGRATION_NOTES.md`,
`OANDA_INTEGRATION_NOTES.md`, and `SCHWAB_INTEGRATION_NOTES.md` — same format. This is the first background/
scheduled process this app has (everything else is purely request-driven) and the first real per-user data
(contact info + consent), not anonymous analytics.

## What this is for

Real email/SMS notifications when a watchlist-style condition actually fires — price thresholds, the three
watchlist signals (volume displacement, momentum, mean reversion), opening-range breakouts, same-day unusual
options activity, and macro/geopolitical news coverage spikes. Checked every 15 minutes during market hours
(9:30am-4:00pm ET, weekdays) by a Vercel Cron job hitting `/api/cron/check-alerts`.

## Architecture

- `src/lib/data/resend.ts` / `twilio.ts` — plain-fetch clients, no SDK (same convention as every other provider
  in this app).
- `src/lib/data/alerts-db.ts` — Supabase REST CRUD for `alert_subscriptions`/`alert_rules`/`alert_log`. Uses the
  **same** Supabase project as the analytics `events`/`feedback` tables (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  — already configured if you set up analytics), just its own file since this is real personal data, not
  anonymous usage stats.
- `src/lib/agents/trading-agent/skills/alert-conditions.ts` — dispatches each rule to the real signal computation
  it names (reuses `computeVolumeDisplacement`/`computeMomentum`/`computeMeanReversion`/`runOrbBacktest`/
  `computeChainWideUnusualActivity`/`computeCoverageSpike` — no new signal math, just the dispatch + message layer).
- `/api/cron/check-alerts` — the orchestrator: auth check, market-hours gate, fetch active rules, dedupe
  identical ticker+condition+params evaluations across subscribers (most load-bearing for `macro_news_spike`,
  since GDELT rate-limits to ~1 request/5s), edge-triggered send (only on the false→true transition), log every
  attempt to `alert_log` even when delivery is skipped/failed.
- `/api/alerts/subscribe` — POST, validates consent server-side (never trusts the client checkbox alone).
- `/api/alerts/unsubscribe` — GET `?token=`, the link included in every alert email.
- `/api/sms-webhook` — Twilio inbound webhook. Twilio's own STOP handling blocks future sends on Twilio's side
  but does **not** update this app's database — this route is what keeps `alert_subscriptions.active` in sync.

## One-time setup

### 1. Database (same Supabase project as analytics)

In the SQL editor, run:

```sql
create table alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  channel text not null,              -- 'email' | 'sms' | 'both'
  consent_at timestamptz not null default now(),
  unsubscribe_token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references alert_subscriptions(id) on delete cascade,
  ticker text not null,
  asset_class text not null,
  condition_type text not null,       -- price_threshold | volume_displacement | momentum |
                                       -- mean_reversion | orb_breakout | unusual_options | macro_news_spike
  params jsonb not null,
  currently_triggered boolean not null default false,
  last_evaluated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table alert_log (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references alert_rules(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  condition_snapshot jsonb,
  channel text not null,
  delivery_status text not null,      -- sent | failed | skipped-not-configured
  error text
);
```

### 2. Email (Resend)

1. Sign up free at resend.com (3,000 emails/mo, 100/day on the free plan — plenty for a beta).
2. Verify a sending domain (or use their onboarding test domain while testing).
3. Copy the API key into `RESEND_API_KEY`, and set `RESEND_FROM_EMAIL` to a verified sender address.

### 3. SMS (Twilio)

1. Sign up at twilio.com, buy a phone number.
2. Copy Account SID / Auth Token into `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`, the number into
   `TWILIO_FROM_NUMBER`.
3. **A2P 10DLC registration is required for US SMS and is a real multi-day carrier approval process** — SMS
   will not actually deliver until this clears, even with valid credentials. Not something this app can do for
   you.
4. In the Twilio console, set this number's "A message comes in" webhook to
   `https://<your-domain>/api/sms-webhook` (POST). This is what keeps unsubscribes in sync — see the doc
   comment in that route.

### 4. Cron secret + app URL

1. Make up any random string for `CRON_SECRET` (not issued by a provider — it's what the cron route checks in
   its `Authorization: Bearer` header against Vercel's own cron invocation).
2. Set `NEXT_PUBLIC_APP_URL` to your production URL once deployed (used to build the unsubscribe link in emails).
3. Add all of the above to Vercel's Environment Variables for Production (same as every other key in
   `DEPLOYMENT.md`'s checklist) — `CRON_SECRET` also needs to be set for Vercel Cron to actually authenticate;
   Vercel automatically sends it as a Bearer token to cron-invoked routes when configured this way.

`vercel.json`'s cron schedule (`*/15 12-21 * * 1-5`) is a fixed-UTC superset covering both EST and EDT market
hours — the route itself does the precise 9:30am-4:00pm ET trim via `toEasternParts`, so the wider cron window
is safe (it just no-ops outside real market hours rather than needing DST-aware cron scheduling, which Vercel
doesn't support).

## Checklist — verify these once real keys are set

1. **Condition evaluation works even with Resend/Twilio blank.** → *How to check:* leave those unset, manually
   hit `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/check-alerts` (the closest
   local substitute for a real cron tick), confirm `alert_log` rows get `delivery_status='skipped-not-configured'`
   rather than the route crashing.
2. **Consent is enforced server-side.** → *How to check:* POST to `/api/alerts/subscribe` with `consent: false`
   (or omitted), confirm a `400`, not a created subscription.
3. **Edge-triggered dedup.** → *How to check:* create a `price_threshold` rule with a target you know is
   currently crossed, call the cron route twice in a row — confirm only the first call logs a send attempt
   (`currently_triggered` flips false→true→stays true, no resend on the second call).
4. **Real email delivery.** → *How to check:* with a real `RESEND_API_KEY` and a triggered rule, confirm an
   actual email lands in the test inbox, and its unsubscribe link actually deactivates the subscription.
5. **Real SMS delivery + STOP handling** — genuinely unverifiable without a live, A2P-approved Twilio number.
   Once approved: trigger a real SMS alert, reply STOP, confirm the webhook fires and
   `alert_subscriptions.active` flips to `false` for that phone number.

## How to re-test with everything blank

Leave `RESEND_API_KEY`/`TWILIO_*`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` all unset — `isAlertsDbConfigured()`
short-circuits every alerts route to a graceful no-op (`503` on subscribe/unsubscribe, a skipped no-op on the
cron route) rather than throwing, same boundary as every other provider integration in this app.
