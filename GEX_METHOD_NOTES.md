# GEX method notes

Current method: **gex-v2** (changed 2026-10-10). Code: `src/lib/agents/trading-agent/skills/gex-signal.ts`. Tests: `scripts/gex-walls.test.mts`.

## What changed and why

The user compared the strategy's walls with an independent pull for SPY (spot 775) and GLD (spot 378) and they did not match. The cause was three separate things in v1.

| | gex-v1 (before) | gex-v2 (now) |
|---|---|---|
| Wall labels | "Call wall" = strike with the largest `puts - calls` net, "put wall" = the smallest. Under the dealer sign assumption (calls -, puts +) that put the strike where **calls** dominate in the "put wall" slot and the put-heavy strike in the "call wall" slot. | Call wall = the strike **above spot** with the most **call** gamma. Put wall = the strike **below spot** with the most **put** gamma. The three largest of each are returned (`callWalls`, `putWalls`). |
| Expirations | The single nearest expiration only (for SPY, tomorrow's). Tomorrow's gamma is very large per contract, so one day's strikes decided everything and the walls jumped day to day. | Open interest from every expiration in the next **45 days** (nearest 12 at most, to bound data calls). |
| Gamma flip | Strike-by-strike sign change of the net at today's spot. | **Spot sweep**: every contract is re-priced at spots from -15% to +15% (60 steps) and the zero crossing nearest spot is returned. `null` if net gamma keeps one sign. |
| Expiry time | Midnight UTC of the expiration date, so today's expiry was excluded for the whole trading day. | 4pm US Eastern (20:00 UTC) on the date, so today's expiry counts until the close. Time to expiry never goes below a quarter of a day in the maths. |

Worked check (Yahoo chains, 8 Oct 2026, 9:47 ET): SPY v1 rule on tomorrow's expiry gave a "call wall" of 767 and a "put wall" of 780. Those are the same two strikes as the by-side walls for that expiry (call wall 780, put wall 767), just with the labels swapped. Across the 45-day window v2 gives SPY call wall 780 and put wall 775; GLD call wall 380 and put wall 375 (345 is a larger but far-away put strike, shown as the first of the put walls because it carries the most put gamma below spot).

## What did NOT change

- The per-contract maths (`blackScholesGreeks` gamma, dollar gamma per 1% move = gamma x spot^2 x 0.01 x open interest x 100).
- The dealer sign assumption (dealers short calls, long puts). It still drives the **regime label** (`positive` / `negative` total net GEX) and the quadrant. It does **not** affect the walls or the flip level; the zero crossing is the same under the opposite sign.
- The IV term structure still compares the first two expirations on or after today (`nearExpiration`, `farExpiration`). Those two also key the paper-trade log.

## Limits worth remembering

- The sign of dealer positioning cannot be seen in public data (see the earlier sign-assumption discussion). Treat "positive / negative gamma" as an assumption; treat the walls and the flip as a map of where option positioning is concentrated.
- Open interest is the previous day's figure.
- Walls are not a forecast that price will stop there. Near-dated gamma still carries the most weight per contract, so the nearest expirations still shape the walls even in a 45-day window.
- The window is capped at 12 expirations. SPY had exactly 12 expirations inside 45 days on 8 Oct 2026, so the cap just fit; in weeks with more daily or weekly expirations it can cut the far end, and the signal says so in `dataLimitations` when it happens.
- A single far strike can top the list (GLD 345 is 9% below spot). The runners-up are returned so the nearby structure is still visible.

## Paper-trade log versioning

`gex-paper-backtest-log.json` rows now carry `methodVersion`. Rows written before this change have no stamp and are read as `gex-v1`. A v2 signal is logged even if a v1 row exists for the same underlying and expiration, and is deduplicated only against other v2 rows. Do **not** pool v1 and v2 rows in one backtest: the `signalLabel` quadrant uses the walls (through the flow at the walls) and so can differ between methods for the same day. `pinnedNearWall` takes the nearer of the two walls, so the label swap did not change it, but v2 walls come from a wider window.

## Where it shows up

- API `GET /api/gex-signal?ticker=`: new fields `methodVersion`, `expirationsUsed`, `windowDays`, and `gexRegime.callWalls` / `putWalls`.
- Options dashboard cards: wall labels have hover text, the runners-up are listed, and a line states how many expirations were combined.
- Paper backtest log tab: a Method column.
- Assistant tool `get_gex_signal`: description updated.

## Regime label: how balanced the two sides are (added 2026-10-13)

The user asked why the options scanner showed negative regimes almost everywhere. A survey of 15 live chains (12-13 Oct 2026) found it was not a bug: the label is `sign(puts - calls)` under the assumption that dealers are short the calls and long the puts, so **call-heavy gamma reads negative**, and single names are call-heavy by gamma (calls sit near the money where gamma is highest; hedging puts sit far out where each contract carries little). MSFT, AAPL, META, AMZN, NVDA read 25-76% call-heavy; SPY, GLD, AMD, INTC were within about 2% of balanced, so their sign was a coin flip; QQQ, IWM, XLF read positive. The v2 window did not cause it (11 of 15 negative on the nearest expiration alone, 9 of 15 across 45 days).

`GexRegime` now also carries `callGamma`, `putGamma`, `grossGex`, `netToGrossPct`, `balanced` (net within `BALANCED_BAND_PCT` = 10% of gross, a judgement threshold, not a tested one) and `regimeOppositeConvention` (the label if dealers hold the other side). `regime` itself is unchanged because the strategy scanner and the quadrant label read it; the dashboard shows "balanced" when `balanced` is true, the net percentage, and the opposite-convention label, and `dataLimitations` says when a label is a coin flip. The strategy scanner still treats a balanced reading by its sign: that is a known simplification, not yet changed.

Faye's deep dive (`pilp/options_math.py`) got the same fields and wording.

## Reading the signal under the other dealer assumption (added 2026-10-15)

The regime label rests on which side dealers are assumed to hold, and that cannot be seen in public data. The Options dashboard card and the Gamma Heat Map tab therefore let the reader switch it. `skills/gex-sign.ts` (pure, client-safe) holds `applyDealerSign(signal, mode)`: "app" (dealers short calls, long puts, how the signal is computed and logged) returns the signal unchanged; "standard" (dealers long calls, short puts, the usual reading when customers buy puts to hedge and sell calls) flips the regime label, the sign of total net gamma and of net-to-gross, swaps `regimeOppositeConvention`, and recomputes the quadrant, so the strategy ideas that follow from it change too. Walls, the gamma flip, balance and gross gamma do not depend on the setting. The paper-backtest log always records the app convention. `classifyQuadrant` moved to `gex-sign.ts` and is re-exported from `gex-signal.ts`. Tests: scripts/gex-walls.test.mts.
