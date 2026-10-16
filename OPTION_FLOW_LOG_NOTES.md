# Intraday option-flow log: notes and pre-registered evaluation plan

Status: logger built 2026-10-15. This is a LOG ONLY. It records raw put/call flow measures; it does not label a
snapshot bullish or bearish, does not choose between the two readings below, and produces no trade signal. Nothing in it
depends on the dealer-sign setting.

## Why it exists

Step 2 of the strategy (intraday put/call flow + anchored volume profile + GEX map) rests on a question nobody has
answered with data yet. Two readings of the same number compete:

- **Flow reading** (what `skills/options-flow-skew.ts` does with put/call volume above 1.5 or below 0.7): more puts is
  bearish, more calls is bullish.
- **Contrarian reading** (the user's): more calls is bearish, more puts is bullish.

They are exact mirrors of each other, so at most one can be right on a given sample. The logger records the inputs so
both can be scored on forward data, and so other definitions can be tried later without having needed to be logged in
advance (hence the per-contract detail).

## What is recorded

One row per symbol per 5-minute bucket, regular session only (9:30 to 16:00 ET, weekdays; the last bucket is 15:55).
Symbols are one constant: `OPTION_FLOW_SYMBOLS` in `src/lib/agents/trading-agent/skills/option-flow-snapshot.ts`
(currently SPY, QQQ, NVDA, DELL, GLD). Table: `option_flow_snapshots`
(`db/migrations/2026-10-15_option_flow_snapshots.sql`), unique on (symbol, snapshot_time).

Two expiration windows:

- **Flow window**: expirations within 10 calendar days, nearest 6 at most. Used for every volume and premium measure.
- **OI window**: the app's GEX window (45 days, nearest 12 at most, from `windowExpirations` in `skills/gex-signal.ts`).
  For SPY and QQQ, which have daily expirations, the 12-expiration cap binds, so this is roughly the next two and a
  half weeks, not 45 days.

Columns, grouped:

| Group | Columns | Notes |
| --- | --- | --- |
| Time | `snapshot_time`, `actual_fetch_time`, `session_date` | `snapshot_time` is the bucket start (ET-aware), `actual_fetch_time` is when the data was really fetched, `session_date` is the ET date. **Analysis must use `actual_fetch_time`.** |
| Price | `spot` | Underlying last price at fetch, from the app's `fetchQuote` (Alpaca IEX or Schwab, cached up to 30 s by Next). |
| Cumulative flow | `call_volume`, `put_volume`, `call_premium`, `put_premium`, `pc_volume`, `pc_premium` | Day-to-date over the flow window. Premium is volume x mid x 100, using the last trade when there is no valid two-sided quote (both sides positive, not crossed). `premium_fallback_volume` and `premium_unpriced_volume` say how much volume was priced at last or not at all. Put/call is puts divided by calls and is **null** when calls are 0, never Infinity or NaN. |
| Open interest | `oi_call`, `oi_put`, `pc_oi`, `oi_expirations_used`, `oi_asof` | OI window. Open interest only changes overnight, so it is fetched once per session per symbol and carried forward (see "Call budget"). The first ticks of a session can have it null. |
| New volume | `new_call_volume`, `new_put_volume`, `pc_new_volume`, `minutes_since_prev` | Change since the previous snapshot of the same session, computed per expiration so that a chain that failed to load is not read as a volume drop. Null on a session's first snapshot. `minutes_since_prev` is real elapsed time, so a delta over a 15-minute gap is visibly a 15-minute delta. |
| Change since first | `first_pc_volume`, `first_pc_premium`, `pc_volume_chg`, `pc_premium_chg` | Cumulative put/call minus its value at the session's first snapshot that had one. The 9:30 snapshot often has almost no volume, so treat this column with care. |
| Aggressor proxy | `agg_call_buy`, `agg_call_sell`, `agg_put_buy`, `agg_put_sell`, `agg_unclassified` | See the next section. |
| Vol | `iv_atm_near`, `iv_atm_next` | ATM implied vol (a fraction, 0.21 = 21%) of the nearest and the next flow-window expiration: mean of the call and put IV at the strike nearest spot, within 3% of spot. Null if none. The nearest expiration can be same-day, where IV is unreliable late in the day. |
| Quality | `stale`, `clamped`, `flags`, `provider_calls`, `expirations_used`, `expirations_failed` | See "Flags". |
| Data feed | `data_feed`, `quote_lag_seconds` | `data_feed` is `'sandbox'` (delayed about 15 minutes) or `'production'` (real-time): which Tradier environment the row came from. `quote_lag_seconds` is the fetch time minus the newest trade, bid or ask timestamp among near-the-money contracts, null when Tradier sent none. See "Data feed". |
| Detail | `contracts` | See "Per-contract detail". |

## The aggressor proxy, and why it is crude

For the new volume of each near-the-money contract (below), the proxy compares the contract's `last` price with its bid
and ask at snapshot time: `last` at or above the ask counts as buy-side, at or below the bid as sell-side, anything else
(inside the spread, no quote, crossed quote, locked market) as unclassified. Volume that cannot be placed on a
contract (outside the stored band, or outside the previous snapshot's stored contracts) is also unclassified.
`agg_unclassified` is whatever is left of the total new volume.

This is **not** trade classification. A snapshot cannot do Lee-Ready, which matches every trade to the quote
prevailing at that instant. Specific limits:

- The quote is the quote at snapshot time; the trade may be minutes older, when the market was somewhere else.
- A contract that traded several times in the interval shows only its latest trade price. All of its new volume gets
  that one label.
- A trade at the ask can be a buyer lifting an offer, or a market maker's hedge, or one leg of a spread.
- Whether a contract trade is opening or closing is not observable at all.

Use these five columns as a rough tilt measure, never as ground truth about who was buying.

## Flags

- `stale`: the cumulative volume of the shared expirations did not change since the previous snapshot. On a session's
  first snapshot, also set (with `same_as_prior_session`) when the volumes equal the previous session's final snapshot,
  which is what a holiday looks like when the provider keeps serving yesterday's numbers. Holidays are not in any
  calendar here; this is the only detection. Early-close days (1pm) will show stale snapshots after the close.
- `clamped` (flag `volume_dropped`): a cumulative volume fell versus the previous snapshot. The delta is clamped at 0
  for that expiration and side. `contract_volume_dropped` is the same at contract level in the aggressor calculation.
- `expirations_changed` and `chain_load_failed`: the expirations differ from the previous snapshot, or a chain failed to
  load. Deltas then cover only the expirations present in both.
- `gap`: more than 7.5 minutes since the previous snapshot.
- `first_of_session`, `zero_volume`, `no_prev_contract_detail`, `agg_exceeds_new_volume`, `oi_chain_load_failed`.

Rows with `stale` or `clamped` set are excluded from the evaluation below.

## Per-contract detail

`contracts` is an array of `[expIdx, strike, right, volume, oi, bid, ask, last, iv]` for strikes within 10% of spot, in
the first three flow-window expirations (`expIdx` indexes `expirations_used`; right is "c" or "p"; iv is a fraction).
Contracts with no volume and no open interest are left out. It exists so the measures can be recomputed or redefined
later (for example delta-weighted, or restricted to near-the-money strikes) without having logged them in advance.

Measured on a synthetic SPY-like chain ($1 strikes, 726 contracts): 30.6 KB of JSON per row, asserted under 40 KB in
the tests. Single names with wider strike spacing are much smaller.

## Scheduler

Vercel Hobby allows one daily cron (`vercel.json`), so, exactly as for alerts (`ALERTS_INTEGRATION_NOTES.md`,
`.github/workflows/check-alerts-cron.yml`), a GitHub Actions workflow
(`.github/workflows/option-flow-cron.yml`) hits `GET /api/cron/option-flow` with `Authorization: Bearer $CRON_SECRET`.
The route checks the secret exactly as `/api/cron/check-alerts` does, returns `{skipped:true}` outside the regular
session, and otherwise snapshots each symbol (two at a time, each in its own try/catch so one failure never fails the
others). The workflow runs every 5 minutes over 13:30 to 20:55 UTC on weekdays, a superset of the session in both EST
and EDT; the route trims to the exact ET session.

**Best effort.** GitHub's scheduled workflows are not guaranteed: runs are delayed, often by several minutes at busy
times, and some are skipped. A public repository with no activity for 60 days has its schedules disabled, and schedules run
only from the default branch. Therefore:

- Every row stores its actual fetch time. Analysis must use `actual_fetch_time`, never an assumed 5-minute spacing.
- Two runs landing in one bucket overwrite each other (idempotent upsert on symbol + bucket); a missed bucket is simply
  absent, and the next row's `minutes_since_prev` and `gap` flag say so.
- The route returns HTTP 502 when no symbol could be stored, so the Actions run turns red instead of silently logging
  nothing.

## Call budget (Tradier)

Per symbol per tick: 1 expirations call plus one chain call per flow-window expiration (at most 6), so at most 7 Tradier
calls, plus 1 quote call through the app's quote provider. Five symbols: at most 35 Tradier calls per tick, around 2,700 per session.
On a symbol's first tick (and until its OI pass succeeds), the OI window adds up to 6 more chains; at most 2 symbols do
that per tick, so the worst tick is about 47 Tradier calls and the first three ticks of a session cover all five
symbols. Tradier's documented limits are about 60 requests per minute on sandbox and 120 on production, so this fits
if nothing else is hitting the same token at the same moment (the GEX and Gamma Heat Map tabs also use it). Not
verified against the live account: expect roughly 10 to 20 seconds per tick, well inside the route's 60-second budget.

Expirations and chains are fetched with Next's data cache bypassed (`fresh` option in `src/lib/data/tradier.ts`); the
default 5-minute cache would otherwise serve consecutive snapshots the same chain.

## Data feed: sandbox (default, delayed) or production (opt-in, real-time)

The logger can read Tradier from two environments, chosen per run by the cron route:

| Mode | How it is selected | Base URL | Token | Data |
| --- | --- | --- | --- | --- |
| `sandbox` (default) | `OPTION_FLOW_TRADIER_MODE` unset, empty, or `sandbox` | `https://sandbox.tradier.com/v1` | `TRADIER_ACCESS_TOKEN` | Real market data, **delayed about 15 minutes** (`TRADIER_INTEGRATION_NOTES.md`). |
| `production` (opt-in) | `OPTION_FLOW_TRADIER_MODE=production` **and** `TRADIER_PRODUCTION_TOKEN` set | `https://api.tradier.com/v1` | `TRADIER_PRODUCTION_TOKEN` | Real-time for brokerage account holders. |

Why it matters: the logger takes a snapshot every five minutes and pairs it with `spot` from another provider. With the
sandbox feed the option measures describe the market about 15 minutes before `actual_fetch_time` while `spot` does not,
so forward returns measured from the fetch time would not be forward of the flow, and any live alert built on it would
be 15 minutes late. The production feed removes that gap.

**Rules the code enforces.**

- Production is used only when both variables are set. If `OPTION_FLOW_TRADIER_MODE=production` and the token is missing,
  the route answers HTTP 503 naming the missing variable, **before any request**: nothing is fetched and nothing is written.
  It never falls back to sandbox, because a silent fallback would mix delayed and real-time rows in one log.
- An unrecognised mode value (for example `prod`) fails the same way, for the same reason: treating it as sandbox would
  hand you delayed data while you believe you switched. Matching ignores case and surrounding spaces; empty or unset means sandbox.
- The sandbox token is never used for production or the other way round. In production mode `TRADIER_ACCESS_TOKEN` is not needed.
- The feed is an explicit argument passed from the route through the service to each Tradier call (no module-level
  setting), so concurrent requests cannot affect each other. Production requests are always fetched uncached.
- Nothing else in the app changes: the GEX signal, Gamma Heat Map, options dashboard and strategy features call the
  Tradier client without a feed and stay on the sandbox. The client also refuses any path other than the two option
  market-data paths (expirations, chains), so account, order and watchlist endpoints cannot be reached.
- Every row records `data_feed`. Rows logged before the switch stay `'sandbox'` (including rows written before the column
  existed: the column defaults to `'sandbox'`). **Analyse one feed at a time**: filter on `data_feed` (for example
  `where data_feed = 'production'`) and do not pool delayed and real-time rows. If the feed changes during a session, the
  first row after the change carries the flag `feed_changed`; its new-volume delta spans both feeds (the cumulative totals
  are still right).

**How to switch.**

1. In Vercel (Project > Settings > Environment Variables, Production): add `TRADIER_PRODUCTION_TOKEN` (your api.tradier.com
   token) and add `OPTION_FLOW_TRADIER_MODE` = `production`. Do not paste the token into chat or into a committed file.
2. Redeploy (environment variable changes apply to new deployments only).
3. To go back, set `OPTION_FLOW_TRADIER_MODE` to `sandbox` or delete it, and redeploy.

**How to verify on the first run.** The Intraday Put/Call tab shows a badge next to the status chip ("Real-time feed" or
"Delayed feed (about 15 min)") and a line "Newest quote is N minutes old". The same figure is in the database:
`select symbol, snapshot_time, data_feed, quote_lag_seconds from option_flow_snapshots order by snapshot_time desc limit 10;`.
`quote_lag_seconds` is the fetch time minus the newest `trade_date`, `bid_date` or `ask_date` among contracts within 3% of
spot. Expect about 900 or more on the sandbox feed and a few seconds up to roughly a minute on production during active
trading. If production rows still show about 900, the token or account is not entitled to real-time data: switch back and
check with Tradier. A null means Tradier did not send those fields (see below).

**Limits of the lag figure.** The three timestamps are fields Tradier's chain response documents (epoch milliseconds), but
they had not been checked against a live response when this was written; the first run is that check (`quote_lag_seconds`
null on every row means the fields are absent or named differently, and `tradier.ts` should be adjusted). `bid_date` and
`ask_date` are when the quote last changed, so a quiet name late in the day can show a large lag on a perfectly
real-time feed; the newest of the near-the-money contracts is used to limit that. Judge the feed by the SPY or QQQ rows
mid-session, not by a thinly traded name or the first and last minutes.

## Storage and retention

Rough figures, not measured on a live database:

- Scalar columns plus the small jsonb fields: about 1 KB per row. 5 symbols x 78 buckets = 390 rows per session, so
  about 0.4 MB per session, roughly 100 MB per year.
- Per-contract detail: about 30 KB for SPY and for QQQ, 20 to 30 KB for GLD, under 10 KB for NVDA and DELL, so about
  100 KB per tick and about 8 MB per session before Postgres compresses large jsonb values (it may roughly halve it).

Retention is set in `OPTION_FLOW_CONFIG`: per-contract detail is nulled after 14 days (`detailRetentionDays`; about
110 MB at steady state before compression), and whole rows are deleted after 400 days (`rowRetentionDays`). The route
runs `prune()` once per session, on the opening bucket. If the Supabase plan is small, lower `detailRetentionDays`
first. The delete and the null-out are two `prune(olderThanDateKey, {detailOnly})` calls in
`src/lib/data/option-flow-db.ts`.

## Setup checklist

1. Run `db/migrations/2026-10-15_option_flow_snapshots.sql` once in the Supabase SQL editor.
2. Vercel environment variables: `CRON_SECRET`, `TRADIER_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   plus the market-data keys `fetchQuote` already needs (Alpaca or Schwab).
   Optional, for real-time option data: `OPTION_FLOW_TRADIER_MODE=production` and `TRADIER_PRODUCTION_TOKEN` (see "Data feed").
   Without them the logger uses the delayed sandbox feed, as before.
3. GitHub repository secrets: `APP_URL` and `CRON_SECRET` (the alerts workflow already uses both).
4. Enable the "Option Flow Snapshots (Intraday)" workflow (it must be on the default branch) and run it once by hand
   with "Run workflow" during a session to confirm a row appears.
5. Open Trading Agent, Options, Intraday Put/Call and check the status chip.

---

## Pre-registered evaluation plan

Written 2026-10-15, before any data exists. Nothing below may be changed after seeing results; changes go in a dated
addendum and the affected tests are then labelled exploratory.

### Question

For each name, does an unusually high or low put/call, relative to that name's own recent history at the same time of
day, precede a forward return in the direction of the flow reading (high put/call, lower price) or of the contrarian
reading (high put/call, higher price)?

### Definitions tested (3)

- **D1** cumulative put/call by volume (`pc_volume`)
- **D2** cumulative put/call by premium (`pc_premium`)
- **D3** put/call on only the new volume (`pc_new_volume`)

### Eligible snapshots

A snapshot is eligible if `stale` and `clamped` are false, `pc_*` is not null, the fetch is within 3 minutes of the
bucket start, and (fixed now, not tuned): cumulative calls plus puts at least 500 contracts for D1 and D2, new calls
plus new puts at least 100 contracts for D3. The 9:30 and 9:35 snapshots usually fail these gates.

### Within-name percentile, no look-ahead

For each name and each bucket time of day (for example 10:35), the reference set is that same bucket's value on the
name's previous 20 sessions. The snapshot's percentile is (count below + half the count equal) / 20. At least 15 of the
20 reference values must exist, otherwise the snapshot is not scored. Only sessions strictly before the snapshot's
session are used. **Consequence: the first 20 logged sessions are baseline only; at 40 logged sessions, about 20 are
scorable.** Flag the **top decile** (percentile >= 0.90, "high") and **bottom decile** (percentile <= 0.10, "low").

### Forward returns

Entry and exit use 1-minute bars from a price source independent of the option feed, never the logged `spot` for exits.
Entry price is the close of the last completed 1-minute bar before `actual_fetch_time` (after any lag correction from
the data-delay check above). Exit is the close of the last completed bar before `actual_fetch_time + h`, for
h = 15, 30 and 60 minutes, and separately to the 16:00 close. A snapshot whose horizon runs past 16:00 is dropped for
that horizon (not truncated). Returns are log returns in basis points. The "to the close" horizon is exploratory and
outside the correction family below.

### The two readings, signed

For a flagged snapshot with return r:

- Flow reading signed return: -r when flagged high, +r when flagged low.
- Contrarian reading signed return: the exact negative of that.

Because the readings are mirror images, the hit rate of one is 100% minus the other's (ties, r = 0, excluded and
counted), and the mean signed returns are equal and opposite. So each cell is one two-sided test of "the mean signed
return is zero", and its sign says which reading the data favours. Report both hit rates and both mean signed returns
anyway, per cell, with the high and low tails also shown separately as description only.

### Inference

- Snapshots within a day are not independent (overlapping horizons, persistent flow, one market factor), and the five
  names are correlated (SPY and QQQ especially). The unit of inference is the **session**.
- Per cell (name x definition x horizon): collapse to one mean signed return per session (over that session's flagged
  snapshots), then report the mean over sessions, its 95% interval from a cluster bootstrap that resamples whole
  sessions (10,000 draws), and a two-sided p-value from a sign-flip permutation test on the session means. Hit rate gets
  the same cluster bootstrap interval, computed on all flagged snapshots with sessions as the resampled clusters.
- **Always report n**: the number of flagged snapshots and the number of distinct sessions contributing, per cell.
  Cells with fewer than 10 contributing sessions are reported but not tested.
- **Multiple comparisons**: 5 names x 3 definitions x 3 horizons = 45 tests. Apply Benjamini-Hochberg across all 45
  p-values and call a cell a candidate finding only if its BH-adjusted q is at most 0.10. BH assumes independent or
  positively dependent tests, which is the plausible case here.
- A candidate finding must also keep the same sign in the first half and the second half of the sessions, and be
  larger than a realistic round-trip cost for that name (state the assumption used when reporting).
- Descriptive extras, not tested and not corrected: the high and low tails separately, the "to the close" horizon, the
  app's absolute 1.5 and 0.7 thresholds (put/call levels differ greatly between SPY and a single name, which is why the
  primary test uses within-name percentiles).

### When to evaluate

Not before at least 40 sessions have been logged. Evaluate once at that point and treat it as a pilot (about 20
scorable sessions); repeating the look every week and stopping when something clears the bar would invalidate the
correction. A second, larger evaluation at 100 logged sessions is the one to act on.

### What sample size can and cannot show

A hit rate of 55% against a 50% null needs about 780 independent observations for the usual 5% test with 80% power
(a coin-flip's standard error at n = 780 is about 1.8 points). Flagged snapshots are not independent: 40 sessions
contribute at most 40 independent days per name, not hundreds of snapshots. With roughly 20 scorable sessions, only an
enormous effect would show. If the pilot is flat, the honest conclusion is "not detected at this sample size", not
"no effect", and if one cell clears the bar out of 45 it is as likely noise as signal until the larger evaluation
repeats it. No trading rule should be built on either reading before then.

## Turning the scheduled job on (added when the workflow was pushed)

The workflow ships switched OFF so that it does not fail every five minutes before the table exists. Order: (1) run `db/migrations/2026-10-15_option_flow_snapshots.sql` in the Supabase SQL editor; (2) confirm the Vercel environment variables and the GitHub secrets `APP_URL` and `CRON_SECRET` (the alert workflow already uses the last two); (3) in GitHub, Settings > Secrets and variables > Actions > Variables, create `OPTION_FLOW_ENABLED` = `true`; (4) run the workflow once by hand during a session (Actions > Option Flow Snapshots > Run workflow) and look at the response; (5) check the Intraday Put/Call tab for the first row. To pause logging, set the variable to anything other than `true`.
