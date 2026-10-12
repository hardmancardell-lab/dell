# Catalyst calendar notes

Code: `src/lib/agents/trading-agent/skills/catalyst-calendar.ts` (pure, client-safe, no network). Tests: `scripts/catalyst-calendar.test.mts`.
Surfaces: Research Agent > Macro > Catalyst Calendar tab (`CatalystCalendarTab.tsx`), `GET /api/catalyst-calendar`, and the assistant tool `get_catalyst_calendar`.

Built 2026-10-12 as item 3 of the crypto handoff (`C:\Users\crdll\.claude\crypto-research-desk\DELLEGATE_HANDOFF.md`) because it closes the known gap that the Trading Agent had no calendar tool. It is a **calendar, not a seasonality model**, and an impact tag is a judgement about how much attention an event usually gets, never a forecast of direction.

## Where each date comes from

Official dates were read from the publisher's own page on **2026-10-12** (`CALENDAR_VERIFIED_ON`), and the URL is stored on every event.

| Category | Source | Coverage |
|---|---|---|
| FOMC decisions (decision day = day 2; projections flagged) | federalreserve.gov/monetarypolicy/fomccalendars.htm | all 2026 and 2027 |
| Bank of England MPC decisions | bankofengland.co.uk/monetary-policy/upcoming-mpc-dates | all 2026 and 2027 |
| Bank of Japan meetings (decision day = day 2; Outlook Report flagged) | boj.or.jp/en/mopo/mpmsche_minu/ | all 2026 and 2027 |
| ECB monetary-policy decisions (day 2) | ecb.europa.eu/press/calendars/mgcgc/ | 28-29 Oct 2026 onward only (the page starts there) |
| US CPI (08:30 ET) | bls.gov/schedule/news_release/cpi.htm and bls.gov/schedule/2026/home.htm | 14 Oct 2026 release onward |
| US PPI (08:30 ET) | bls.gov/schedule/2026/home.htm | the three 2026 releases listed there |
| US jobs report (08:30 ET) | bls.gov/schedule/news_release/empsit.htm | 6 Nov 2026 release onward |
| NYSE closures and early closes | nyse.com/trade/hours-calendars | 2026 and 2027 (no 2027 early closes listed) |

Rule-based dates (`basis: "rule"`, stated in each event's note): monthly option expiration (third Friday, moved back a day when NYSE is closed, so **18 Jun 2026 and 17 Jun 2027**), quarterly "quad witching" (Mar/Jun/Sep/Dec), US election day (first Tuesday after the first Monday in November, 3 Nov 2026), and month-end (last weekday).

The month-end entry cites the GBP/JPY test run on 2026-10-10 (about 20.5 bps over 3pm to 5pm London on month-end days versus 13.3 otherwise, 34 month-ends, a range effect with no reliable direction). The gotobi days are **not** included: the same test found no run-up into the Tokyo 9:55 fix.

## Left out on purpose

- **Regulatory deadlines** (GENIUS Act comment dates, the GENIUS effective date, market-structure bill dates). The crypto desk lists some, but none has been checked against a primary source yet, and this app's rule is sourced facts only. Add them only with a primary-source URL, as `category: "regulatory"` once the type exists.
- Earnings dates, Treasury auctions, PCE and GDP releases. Easy to add the same way when wanted.

## How it picks what is relevant to a symbol

US equities: US events, option expirations, market closures. Forex pair (for example GBP/JPY): central banks and data for **both** currencies are rated high impact for that pair, US events stay as a global driver, month-end flow shows for GBP, and no equity option expirations. Crypto: US central bank, inflation, jobs and the election only. The base `impact` on an event never changes; `impactForSymbol` is the re-rated one.

## Yearly maintenance (do this each autumn)

1. Re-read the publisher pages above and update the arrays at the top of the file (FOMC, BoE, BoJ, ECB, CPI, PPI, jobs, NYSE holidays).
2. Bump `CALENDAR_VERIFIED_ON` and the `PARTIAL_COVERAGE` start dates.
3. Extend the rule loops (currently 2026 and 2027) and the date counts in the test file.
4. Run `node --import ./scripts/ts-loader/register.mjs scripts/catalyst-calendar.test.mts`. The calendar warns in its notes when fewer than 60 days of official schedule remain.

## Not done

- **Faye widget allowlist: approved and added 2026-10-12** (`"/api/catalyst-calendar": "GET"` in `FayeChatWidget.tsx`). The widget will now run that call if Faye's server plans it, with the same parameter checks as every other tool (a single `category` value only, because commas are not allowed by the widget's parameter filter). Faye's crypto top-down playbook now plans it (2026-10-12; see CRYPTO_REGIME_NOTES.md). Before that it was inert until Faye's server planned it: Faye's planner is a fixed orchestrator (`Pilp_Assistant/pilp/orchestrator.py`, tool table plus playbooks), so using the calendar there means adding a tool entry and a playbook step in her repo, which is separate work with its own training and eval.
- Nothing has been committed.
