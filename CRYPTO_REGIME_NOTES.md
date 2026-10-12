# Crypto regime read notes

Code: `src/lib/agents/trading-agent/skills/crypto-regime.ts` (scoring, pure), `crypto-regime-service.ts` (orchestrator), `src/lib/data/crypto-public.ts` (keyless data adapters). Tests: `scripts/crypto-regime.test.mts` (44 checks). Surfaces: Research Agent > Macro > Crypto Regime tab, `GET /api/crypto-regime`, assistant tool `get_crypto_regime`.

Built 2026-10-12 as items 1 and 2 of the crypto handoff (`C:\Users\crdll\.claude\crypto-research-desk\DELLEGATE_HANDOFF.md`). It is a **market-level research read, not a gate**: the Trading Agent has no crypto signals yet, so there is nothing for it to gate. Not investment advice, and not a price forecast.

## The score

Six conditions, copied from the Crypto Research Desk dashboard so the two can be compared on the same day's data. Every comparison is strict (a reading exactly on the line is "not met").

| # | Condition | Needs | Source (keyless) |
|---|---|---|---|
| 1 | Stablecoin supply, 30-day change | above +2% | DefiLlama `stablecoins.llama.fi/stablecoincharts/all` (last value over the value 30 entries earlier) |
| 2 | US spot BTC ETF net flows, month to date | above 0 | Farside (see below) or typed in |
| 3 | BTC dominance | below 55% | CoinGecko `/api/v3/global` |
| 4 | BTC close vs its 200-day simple average | above | CoinGecko `market_chart`, 365 daily closes (last point is the running price, as on the dashboard) |
| 5 | US 10-year yield | below 5.0% | Yahoo `^TNX` (delayed). FRED's keyless CSV dropped the connection when tested. |
| 6 | Fear & Greed | below 80 | alternative.me |

4 or more met = breakout regime, 3 = mixed, 2 or fewer = range-bound.

A condition whose data could not be read is **unavailable** and never counts as met. The label is only given when it would be the same whichever way the missing inputs came out; otherwise the read says **undetermined** and shows the possible range.

## Acceptance check (passed)

The handoff asked that the score match the dashboard on the same day's data. Using the dashboard's own data files from 11 Oct 2026 (saved in `scripts/fixtures/crypto_desk_2026-10-11/`), the code scores **2 of 6** with BTC above its 200-day average (83,595 vs about 71,914) and Fear & Greed below 80 met, and the other four not met, and its stablecoin 30-day change equals the dashboard's figure to its four decimals. A live run on 12 Oct 2026 with the ETF flows typed in (-$386.3M) also gives 2 of 6.

## ETF flows: the one input without a free feed

There is **no free API** for US spot BTC ETF flows. The app tries Farside Investors' public table, but Farside answered scripted requests with **HTTP 403** from Node (tested 12 Oct 2026; a plain browser-style request worked from another client). The code does not try to work around that block. The reliable route is to **type the month-to-date total** (from farside.co.uk/btc) into the box on the tab, or pass `?etfFlowsMtdMusd=-386.3` to the API. Check Farside's terms before relying on its data in anything commercial. If neither works, the condition is unavailable and the label may be undetermined.

The parser for Farside's table is tested against a real saved copy (`scripts/fixtures/farside_btc_table_2026-10-12.html`): bracketed numbers are negative, summary rows are ignored, and October 2026 sums to -386.3 over 7 days, matching the dashboard's hand-fed file.

## Politeness and limits

CoinGecko's free tier is rate limited: its calls are spaced 3 seconds apart, a 429 is retried with backoff, and every source is cached in memory for 15 minutes. A cold read takes a few seconds. All of the sources can change or block without notice; one failing never fails the read.

## Not done

- No gating of any signal (there are no crypto signals). If crypto signals are added later, this score is the intended filter: breakout regime on, range-bound off, mixed as a caution.
- **Faye:** `GET /api/crypto-regime` was added to the widget's read-only allowlist on 2026-10-12 (with `/api/catalyst-calendar`), and Faye's server has a **crypto top-down playbook** that uses both (see the Faye notes below). The Faye changes are uncommitted and not pushed, and the Oracle VM copy has not been updated.
- Adviser-side content stays BTC, ETH and spot ETFs until the securities attorney weighs in (compliance flag in the handoff). The handoff's legal claims (CLARITY, GENIUS dates) are unverified by me and are not used anywhere in this feature.
- Nothing has been committed.

## Faye's crypto top-down playbook (item 4 of the handoff)

Built 2026-10-12 in `Documents/Pilp_Assistant/pilp/orchestrator.py` (uncommitted). "Run the crypto top-down", "is crypto in a breakout regime right now" and similar questions make one tool turn (macro overview, this regime read, and the catalyst calendar for BTC-USD, 30 days, high impact) and answer in four layers: macro and dated catalysts, the six-condition regime, then sectors and companies as **what to check next** (the app has no live data for them, so nothing is pulled and no tokens or companies are named). The method and metric catalog come from the Q4 2026 crypto top-down read; its views, price ranges, scenario odds, ticker lists and legal claims are deliberately not carried over. If you tell Faye the month's ETF flows with a direction ("ETF flows this month are -386.3 million"), she passes it to the regime route; a number with no direction is never guessed. Educational questions ("explain the crypto top-down playbook") do not start a run. Tested by 70 new checks in `pilp/orchestration_eval.py` (203 in all, plus `selftest.py` 27/27) against real recorded payloads saved in `tests/fixtures/crypto_regime.json` and `btc_catalyst_calendar.json`.
