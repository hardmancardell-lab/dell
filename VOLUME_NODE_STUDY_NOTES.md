# Anchored volume profile and the node-reaction study

Step 1 of a larger plan (intraday put/call flow + anchored volume profile + GEX map for entries and exits). This step builds the
volume-profile tool and tests one thing about it: does price react at a prior session's volume nodes any differently than at a
random price? Options flow and GEX are out of scope here.

## What was built

- `src/lib/agents/trading-agent/skills/anchored-volume-profile.ts`: pure module. `buildProfile(candles, opts)` gives bins, total
  volume, POC, 70% value area (VAL/VAH), HVN and LVN lists; `selectAnchoredCandles` / `buildAnchoredProfile` pick the bars for an anchor
  (`session`, `previousSession`, `fromTimestamp`, `fromDate`, `multiDay`). Equities use the 9:30-16:00 Eastern session (DST-safe through
  `toEasternParts`); crypto product ids (`BTC-USD`) use UTC days.
- `GET /api/anchored-volume-profile?ticker=&anchor=session|previous|multi|date:YYYY-MM-DD|time:ISO&days=&bins=`: 5-minute bars through
  `fetchBarsForTimeframe`, returns the profile, the bars used, the anchor and the data limitations. Locally the provider keys are
  placeholders, so it only returns data in production.
- "Volume Profile" tab in the Trading Agent Equities group (`AnchoredVolumeProfileTab.tsx`).
- Tests: `scripts/anchored-volume-profile.test.mts`.

### Approximations (all disclosed in the UI too)

1. **Volume allocation.** A bar's volume is spread evenly across its low-to-high range (the same approximation `volume-profile.ts`
   already makes). Optional close-weighted mode puts a share (default 50%) on the bin holding the close. The true tick distribution
   inside a 5-minute bar is unknown.
2. **Bins.** Width = max(tick, range / 60), rounded up to whole ticks; edges on multiples of the width. Levels are good to about
   one bin.
3. **Value area.** Standard expansion from the POC: compare the next two bins above with the next two below, add the larger pair
   (ties go up), stop at >= 70% of volume. Coverage is therefore at least 70% (usually 70-76%), and the area is contiguous.
4. **Nodes.** Histogram smoothed with a 1-bin Gaussian; peaks are local maxima that are not the two end bins and whose prominence is
   at least 15% of the tallest smoothed peak. The peak whose basin holds the POC is the POC node and is not listed as an HVN. An LVN is
   the lowest point between neighbouring kept peaks, kept only if it sits 15% of the peak below the lower neighbour. The 15% and the
   1-bin sigma are judgment calls, not fitted to anything.
5. **Volume source.** Alpaca free tier is IEX only (a single exchange); Yahoo volume is roughly 78% of consolidated. Absolute volume
   is understated either way, and the shape may differ from consolidated.

## The study (`scripts/volume-node-reaction.mts`)

Question: when price first touches a prior-session node during the next session, does it reject or break, and is that different from
touching a random level?

### Definitions, fixed before any result was seen (not tuned afterwards)

- **Data:** Yahoo 5-minute bars, `range=60d`, regular hours. Symbols SPY, QQQ, NVDA, DELL, AAPL, MSFT, AMD, TSLA. 60 sessions each
  (2026-07-23 to 2026-10-15), so 59 prior-session/next-session pairs per symbol, 472 pairs in all.
- **Levels:** from session D-1's own bars only (no look-ahead), default profile settings. Groups: POC; VA (VAH and VAL); HVN; LVN.
  2,190 levels were listed (472 each POC, VAH, VAL; 387 each HVN, LVN).
- **Touch:** first bar in session D, from the 9:45 bar on (first 15 minutes skipped), whose low-to-high contains the level. Arrival
  side is the sign of the previous bar's close minus the level. A touch needs 6 full bars after it (30 minutes), else it is dropped
  (30 real, 25 control touches dropped for this).
- **Outcome:** X = 0.25 x session D-1's average 30-minute high-low range. Over the 6 bars after the touch bar, **reject** = price
  gets X away on the side it came from before getting X through the level; **break** = the reverse; otherwise neither. A bar that
  reaches both is ambiguous and counted as not-reject (conservative; 110 real touches). Signed excursion = (close of the 6th bar -
  level) x arrival side / X.
- **Control:** for every real level, one uniformly random level inside D-1's low-to-high (seeded), same touch and outcome rules,
  grouped under the real level's group so counts match.
- **Tests:** (a) naive: shuffle real/control labels across touches, 10,000 permutations. (b) cluster (headline): touches on the same
  symbol-day are not independent, so each symbol-day's real and control sets are swapped as a block with probability 1/2, 10,000
  permutations. Both two-sided on the reject-rate difference, fixed seed. Also: one touch per group per symbol-day (the earliest),
  with its own cluster test.

### Results, pooled over the 8 symbols

The touched share is 826 of 2,190 real levels (1,334 were not reached after the first 15 minutes).

| Group | Real n | Real reject (95% Wilson) | Control n | Control reject (95% Wilson) | Diff | p naive | p cluster | One per day: real n / ctrl n, reject, p |
|---|---|---|---|---|---|---|---|---|
| POC | 187 | 48.1% [41-55] | 177 | 41.8% [35-49] | +6.3 pp | 0.251 | 0.231 | 187 / 177, 48.1% vs 41.8%, 0.234 |
| VA (VAH+VAL) | 373 | 50.9% [46-56] | 330 | 43.0% [38-48] | +7.9 pp | 0.044 | 0.032 | 287 / 239, 50.5% vs 43.1%, 0.075 |
| HVN | 130 | 50.8% [42-59] | 135 | 49.6% [41-58] | +1.1 pp | 0.904 | 0.842 | 115 / 118, 49.6% vs 50.0%, 0.945 |
| LVN | 136 | 44.1% [36-53] | 117 | 44.4% [36-53] | -0.3 pp | 1.000 | 0.971 | 118 / 99, 42.4% vs 44.4%, 0.748 |
| All levels | 826 | 49.2% [46-53] | 759 | 44.1% [41-48] | +5.1 pp | 0.047 | 0.036 | |

- Break rate, all levels: real 36.8%, control 42.2%. The rest is neither/ambiguous (about 14% in both).
- Mean signed excursion (units of X, end of 30 minutes): POC +0.52 vs +0.27, VA +0.29 vs +0.20, HVN +0.65 vs +0.75, LVN +0.73 vs
  -0.30. These are noisy (heavy tails; per-symbol cells swing between -3 and +3 X) and are not tested; in percent of price the
  all-level means are +0.077% (real) vs +0.055% (control).
- Independent units: 59 distinct trading dates across the 8 symbols. Symbol-days with at least one touch: 245 (POC), 311 (VA),
  152 (HVN), 140 (LVN), 325 (all). The 8 symbols trade the same days and are correlated, so the effective number of independent
  days is closer to 59 than to 325.
- Per symbol (all levels, real vs control reject): SPY 49.1 vs 39.6 (p cluster 0.118), QQQ 46.5 vs 40.2 (0.362), NVDA 53.2 vs 43.4
  (0.191), DELL 48.3 vs 44.1 (0.523), AAPL 47.7 vs 41.0 (0.397), MSFT 47.0 vs 47.4 (0.981), AMD 48.9 vs 51.2 (0.724), TSLA 52.7 vs
  48.2 (0.497). Six of eight are positive; none is individually distinguishable from chance. Full per-symbol, per-group tables are in the
  saved JSON.

### Reading it

**Mostly a null.** Price rejected at prior-session nodes about 5 points more often than at random levels (49% vs 44%; break rate 37%
vs 42%), but the evidence is weak. The only nominally significant cell is the value-area edges (+7.9 pp, cluster p = 0.032), which
is one of four group tests plus the pooled one (a Bonferroni cut-off of 0.0125 for four groups), and it weakens to p = 0.075 when only
one touch per day is kept. POC points the same way but is nowhere near significant (p = 0.23); HVN and LVN show no difference
at all (+1.1 and -0.3 pp). A reject rate near 50% against a break rate near 36% at a distance of a quarter of a normal half-hour
range is not a tradable edge: no entry rule, no stop, no costs were tested.

Do not read the value-area result as "volume nodes matter". The control is matched on count and on the prior session's range, not on
location or time of touch. POC and value-area edges sit toward the middle of the prior range, where the next session is more likely to
meet them early and from a particular side; a random level in the full range does not. The study cannot separate that from a volume
effect. A cleaner control (same distance from the open and similar touch time) is the obvious next test, and was not run here because the
brief fixed the design in advance.

### Caveats

- **60 days** of 5-minute Yahoo history, one market regime (late July to mid October 2026). Hundreds of touches, but one regime and about
  59 independent dates.
- **Yahoo volume is roughly 78% of consolidated** and 5-minute bars smear volume (even spread across each bar's range).
- **Small cells:** HVN and LVN have 130-136 touches per group pooled and 10-30 per symbol; intervals are wide (a Wilson range of about
  +/- 8 to 10 points pooled, +/- 15 to 25 per symbol).
- **Multiple comparisons:** 5 pooled tests and 40 per-symbol tests were run; some will look significant by chance. None was
  chosen after the fact; the parameters above are the only ones run.
- **Bars, not ticks:** a touch is a bar whose range crosses the level, so the touch time is known only to 5 minutes, and outcomes are
  checked bar by bar. The touch bar's own range is excluded from the outcome window (the same for control).
- **No costs, no slippage, no entry rule:** this measures reaction only.
- Re-running later shifts the 60-day window, so numbers will change. `REFETCH=1` refreshes the cached bars; results JSON is written to the
  session scratchpad, not the repo.

## Run it

```
node --import ./scripts/ts-loader/register.mjs scripts/anchored-volume-profile.test.mts
node --import ./scripts/ts-loader/register.mjs scripts/volume-node-reaction.mts
```
