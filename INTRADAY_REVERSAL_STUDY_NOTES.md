# Intraday reversal study: when do the high and low form, and does a key reversal at a fresh extreme predict anything?

Price only (Yahoo 5-minute bars). Option, put/call and flow legs are not tested here; they come later from the option-flow logger.
Script: `scripts/intraday-reversal-study.mts` (data fetch, both studies, tables). Detection and outcome functions: `scripts/intraday-reversal-detect.mts`. Tests: `scripts/intraday-reversal-study.test.mts`.
Run: `node --import ./scripts/ts-loader/register.mjs scripts/intraday-reversal-study.mts` (bars are cached in the session scratchpad after the first download; `REFETCH=1` forces a new download). The raw results JSON and the table markdown below were written to the scratchpad by that run.

## 1. Pre-registered definitions (fixed before any result was looked at)

**Data.** Yahoo `range=60d&interval=5m`, browser User-Agent. Symbols: SPY, QQQ, NVDA, DELL, GLD (reported individually) plus AAPL, MSFT, AMD, TSLA (wider pool; all nine pooled). Regular session only, 9:30-16:00 ET, converted with `Intl.DateTimeFormat` / America/New_York (the repo's `toEasternParts`), so daylight-saving changes are handled. Sessions with fewer than 70 five-minute bars are dropped (half days); this run also required the first bar to start at 9:30 and the last at 15:55 (no sessions failed any of these tests). Yahoo 5-minute volume is about 78% of consolidated and is not used at all.

**Study A, timing.** For each symbol-session record the 5-minute bar holding the session high and the one holding the session low (first bar if tied), mapped to 13 thirty-minute buckets (9:30, 10:00, ..., 15:30). Report n, share per bucket with Wilson 95% intervals, per symbol and pooled, high and low separately. Benchmark: a permutation null that keeps each session's own 5-minute bars (each bar as a unit: close/open, high/open, low/open) and shuffles their order, 10,000 shuffles per session, fixed seed (20261015), bars chained close-to-next-open. That preserves the day's volatility and drift size and destroys time-of-day structure. Excess over the null per bucket; chi-square-style statistic sum((O-E)^2/E) with a permutation p-value (replicate b uses shuffle b of every session in the group); a bucket is called OVER (UNDER) if its one-sided permutation p is at most 0.05/13. Also the share of sessions with the high, the low, or either in the first or last 30 minutes.

**Study B, key reversal.**
- Evaluated on 5-minute bars at their close. The first evaluated bar is the one that starts at 10:00 (the first 30 minutes are skipped); the last is the one that starts at 15:25 and closes at 15:30 (30 minutes are left for the outcome).
- Bearish key reversal at bar t: bar t's high is strictly above every earlier high of the session, AND bar t closes in the lowest 25% of its own high-low range (close <= low + 0.25 x range), AND bar t closes strictly below the previous bar's low. Bullish is the mirror at a fresh session low (close >= high - 0.25 x range, strictly above the previous bar's high). A zero-range bar is never a reversal.
- Real-time rule: detection reads bars 0..t only. The realised high or low is never used to detect. This is tested (truncating or replacing future bars never changes an earlier detection).
- Outcome, signed in the reversal's direction (positive = the reversal worked; down after a high, up after a low), in basis points from bar t's close to the close of t+3 bars (15 min), t+6 (30 min), t+12 (60 min) and the session close. "Extreme holds" = the high (low) set at t is not exceeded in the following 30 minutes (6 bars). Whether bar t turned out to be the realised session high or low is recorded.
- Control 1: bars in the same time bucket that set a fresh session high (low) but do not meet the reversal conditions. Control 2: random bars from the same symbol and 30-minute bucket, same direction label, sampled without replacement to the same count (seed 7003); the reversal events themselves are excluded from the pool.
- Tests: for each direction x horizon x control the statistic is the reversal mean minus the control mean, stratified by symbol x direction x 30-minute bucket and weighted by the number of reversals per cell (so the control is reweighted to the reversals' time-of-day mix). P-value: 10,000 permutations (seed 7001 plus an offset per test) shuffling labels within cell, two-sided. Family for Benjamini-Hochberg: 2 directions x 4 horizons x 2 controls = 16. The "both directions pooled" rows, the extreme-holds comparison and the time-of-day split are descriptive and outside the family. Confidence intervals: 5,000 bootstrap resamples of whole DATES (all symbols that day together, because the nine symbols trade the same days).
- No costs, no entry rule. Cost context only: an assumed round trip of about 1 bp for SPY and about 3 bp for the other symbols.

**Implementation choices the brief left open** (chosen before running, not tuned): a horizon that runs past the 16:00 close is missing for that event (so the 60-minute column has fewer events than the others; the "to close" column uses all); the cell for control matching is symbol x direction x 30-minute bucket; bucket = floor((bar start - 9:30) / 30 minutes).

**One thing added after the first look, and why.** After seeing the first Study A output (the 9:30 bucket flagged OVER everywhere), I added a supplementary null that keeps every bar in its own time slot and size and only randomises its direction, because the pre-registered shuffle also moves the large opening and closing bars to random times and so cannot separate "extremes cluster at the open" from "volatility is highest at the open". The pre-registered null and its flags are reported unchanged; the supplement is labelled as such and nothing in Study B was changed.

## 2. Results

### Study A tables

#### SPY (60 sessions)
Chi-square-style statistic vs the shuffle null: high = 13.1 (permutation p 0.309), low = 19.4 (p 0.053).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 18 | 30.0% (20%-43%) | 18.3% | +11.7 | 0.010 |  | 14 | 23.3% (14%-35%) | 15.8% | +7.5 | 0.038 |  |
| 10:00 | 3 | 5.0% (2%-14%) | 8.7% | -3.7 | 0.906 |  | 6 | 10.0% (5%-20%) | 6.8% | +3.2 | 0.212 |  |
| 10:30 | 4 | 6.7% (3%-16%) | 7.1% | -0.4 | 0.616 |  | 8 | 13.3% (7%-24%) | 5.7% | +7.7 | 0.016 |  |
| 11:00 | 5 | 8.3% (4%-18%) | 6.2% | +2.1 | 0.318 |  | 5 | 8.3% (4%-18%) | 5.2% | +3.1 | 0.197 |  |
| 11:30 | 5 | 8.3% (4%-18%) | 5.7% | +2.6 | 0.251 |  | 4 | 6.7% (3%-16%) | 5.0% | +1.6 | 0.361 |  |
| 12:00 | 4 | 6.7% (3%-16%) | 5.3% | +1.3 | 0.401 |  | 2 | 3.3% (1%-11%) | 5.0% | -1.7 | 0.807 |  |
| 12:30 | 3 | 5.0% (2%-14%) | 5.2% | -0.2 | 0.607 |  | 2 | 3.3% (1%-11%) | 5.2% | -1.8 | 0.828 |  |
| 13:00 | 1 | 1.7% (0%-9%) | 5.0% | -3.4 | 0.957 |  | 5 | 8.3% (4%-18%) | 5.4% | +2.9 | 0.223 |  |
| 13:30 | 0 | 0.0% (0%-6%) | 5.1% | -5.1 | 1.000 |  | 1 | 1.7% (0%-9%) | 5.7% | -4.1 | 0.972 |  |
| 14:00 | 1 | 1.7% (0%-9%) | 5.2% | -3.6 | 0.957 |  | 2 | 3.3% (1%-11%) | 6.2% | -2.9 | 0.894 |  |
| 14:30 | 3 | 5.0% (2%-14%) | 5.6% | -0.6 | 0.671 |  | 2 | 3.3% (1%-11%) | 7.1% | -3.7 | 0.938 |  |
| 15:00 | 5 | 8.3% (4%-18%) | 6.8% | +1.5 | 0.387 |  | 2 | 3.3% (1%-11%) | 8.7% | -5.4 | 0.973 |  |
| 15:30 | 8 | 13.3% (7%-24%) | 15.7% | -2.4 | 0.804 |  | 7 | 11.7% (6%-22%) | 18.1% | -6.4 | 0.957 |  |

First or last 30 minutes (buckets 9:30 and 15:30): high 43.3% (Wilson 32%-56%; null 34.1%, null 95% range 23%-45%; p over 0.073); low 35.0% (24%-48%; null 33.9%, 23%-45%; p 0.483); high OR low in an edge bucket 68.3% (56%-79%; null 58.3%, 47%-70%; p 0.056).

#### QQQ (60 sessions)
Chi-square-style statistic vs the shuffle null: high = 19.9 (permutation p 0.048), low = 29.8 (p 0.003).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 21 | 35.0% (24%-48%) | 17.5% | +17.5 | <0.001 | OVER | 20 | 33.3% (23%-46%) | 16.8% | +16.5 | <0.001 | OVER |
| 10:00 | 5 | 8.3% (4%-18%) | 8.7% | -0.4 | 0.609 |  | 11 | 18.3% (11%-30%) | 7.0% | +11.3 | 0.002 | OVER |
| 10:30 | 2 | 3.3% (1%-11%) | 7.0% | -3.6 | 0.933 |  | 3 | 5.0% (2%-14%) | 5.7% | -0.7 | 0.668 |  |
| 11:00 | 4 | 6.7% (3%-16%) | 6.2% | +0.5 | 0.517 |  | 4 | 6.7% (3%-16%) | 5.2% | +1.4 | 0.378 |  |
| 11:30 | 5 | 8.3% (4%-18%) | 5.6% | +2.7 | 0.250 |  | 3 | 5.0% (2%-14%) | 5.0% | -0.0 | 0.589 |  |
| 12:00 | 2 | 3.3% (1%-11%) | 5.3% | -2.0 | 0.841 |  | 1 | 1.7% (0%-9%) | 5.0% | -3.3 | 0.952 |  |
| 12:30 | 1 | 1.7% (0%-9%) | 5.1% | -3.4 | 0.957 |  | 1 | 1.7% (0%-9%) | 5.2% | -3.5 | 0.961 |  |
| 13:00 | 1 | 1.7% (0%-9%) | 4.9% | -3.3 | 0.952 |  | 2 | 3.3% (1%-11%) | 5.3% | -2.0 | 0.837 |  |
| 13:30 | 2 | 3.3% (1%-11%) | 5.0% | -1.7 | 0.809 |  | 1 | 1.7% (0%-9%) | 5.7% | -4.0 | 0.970 |  |
| 14:00 | 2 | 3.3% (1%-11%) | 5.2% | -1.8 | 0.828 |  | 3 | 5.0% (2%-14%) | 6.2% | -1.2 | 0.730 |  |
| 14:30 | 0 | 0.0% (0%-6%) | 5.6% | -5.6 | 1.000 |  | 2 | 3.3% (1%-11%) | 7.1% | -3.8 | 0.937 |  |
| 15:00 | 5 | 8.3% (4%-18%) | 7.0% | +1.4 | 0.407 |  | 3 | 5.0% (2%-14%) | 8.6% | -3.6 | 0.907 |  |
| 15:30 | 10 | 16.7% (9%-28%) | 16.9% | -0.2 | 0.598 |  | 6 | 10.0% (5%-20%) | 17.2% | -7.2 | 0.972 |  |

First or last 30 minutes (buckets 9:30 and 15:30): high 51.7% (Wilson 39%-64%; null 34.3%, null 95% range 23%-47%; p over 0.003); low 43.3% (32%-56%; null 34.0%, 23%-45%; p 0.070); high OR low in an edge bucket 78.3% (66%-87%; null 58.9%, 48%-70%; p <0.001).

#### NVDA (60 sessions)
Chi-square-style statistic vs the shuffle null: high = 31.1 (permutation p 0.002), low = 27.7 (p 0.005).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 28 | 46.7% (35%-59%) | 21.5% | +25.2 | <0.001 | OVER | 20 | 33.3% (23%-46%) | 13.2% | +20.1 | <0.001 | OVER |
| 10:00 | 7 | 11.7% (6%-22%) | 9.2% | +2.5 | 0.308 |  | 5 | 8.3% (4%-18%) | 6.9% | +1.5 | 0.400 |  |
| 10:30 | 2 | 3.3% (1%-11%) | 7.0% | -3.7 | 0.933 |  | 3 | 5.0% (2%-14%) | 5.8% | -0.8 | 0.681 |  |
| 11:00 | 0 | 0.0% (0%-6%) | 5.9% | -5.9 | 1.000 |  | 2 | 3.3% (1%-11%) | 5.2% | -1.9 | 0.831 |  |
| 11:30 | 5 | 8.3% (4%-18%) | 5.4% | +3.0 | 0.219 |  | 4 | 6.7% (3%-16%) | 4.9% | +1.8 | 0.336 |  |
| 12:00 | 2 | 3.3% (1%-11%) | 5.0% | -1.7 | 0.810 |  | 1 | 1.7% (0%-9%) | 4.8% | -3.1 | 0.948 |  |
| 12:30 | 0 | 0.0% (0%-6%) | 4.8% | -4.8 | 1.000 |  | 2 | 3.3% (1%-11%) | 4.9% | -1.6 | 0.801 |  |
| 13:00 | 2 | 3.3% (1%-11%) | 4.8% | -1.4 | 0.788 |  | 3 | 5.0% (2%-14%) | 5.0% | -0.0 | 0.583 |  |
| 13:30 | 2 | 3.3% (1%-11%) | 4.8% | -1.5 | 0.796 |  | 0 | 0.0% (0%-6%) | 5.4% | -5.4 | 1.000 |  |
| 14:00 | 2 | 3.3% (1%-11%) | 5.1% | -1.8 | 0.823 |  | 2 | 3.3% (1%-11%) | 6.0% | -2.7 | 0.883 |  |
| 14:30 | 2 | 3.3% (1%-11%) | 5.6% | -2.3 | 0.861 |  | 1 | 1.7% (0%-9%) | 7.0% | -5.4 | 0.989 |  |
| 15:00 | 1 | 1.7% (0%-9%) | 6.9% | -5.2 | 0.988 |  | 6 | 10.0% (5%-20%) | 9.3% | +0.7 | 0.487 |  |
| 15:30 | 7 | 11.7% (6%-22%) | 14.0% | -2.3 | 0.796 |  | 11 | 18.3% (11%-30%) | 21.6% | -3.3 | 0.818 |  |

First or last 30 minutes (buckets 9:30 and 15:30): high 58.3% (Wilson 46%-70%; null 35.5%, null 95% range 25%-47%; p over <0.001); low 51.7% (39%-64%; null 34.8%, 23%-47%; p 0.005); high OR low in an edge bucket 86.7% (76%-93%; null 60.0%, 48%-72%; p <0.001).

#### DELL (60 sessions)
Chi-square-style statistic vs the shuffle null: high = 85.7 (permutation p <0.001), low = 72.5 (p <0.001).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 35 | 58.3% (46%-70%) | 16.2% | +42.1 | <0.001 | OVER | 30 | 50.0% (38%-62%) | 14.5% | +35.5 | <0.001 | OVER |
| 10:00 | 7 | 11.7% (6%-22%) | 8.3% | +3.3 | 0.223 |  | 6 | 10.0% (5%-20%) | 7.6% | +2.4 | 0.309 |  |
| 10:30 | 3 | 5.0% (2%-14%) | 6.9% | -1.9 | 0.791 |  | 4 | 6.7% (3%-16%) | 6.4% | +0.3 | 0.541 |  |
| 11:00 | 0 | 0.0% (0%-6%) | 6.2% | -6.2 | 1.000 |  | 4 | 6.7% (3%-16%) | 5.8% | +0.9 | 0.467 |  |
| 11:30 | 1 | 1.7% (0%-9%) | 5.8% | -4.1 | 0.974 |  | 0 | 0.0% (0%-6%) | 5.5% | -5.5 | 1.000 |  |
| 12:00 | 3 | 5.0% (2%-14%) | 5.5% | -0.5 | 0.649 |  | 3 | 5.0% (2%-14%) | 5.4% | -0.4 | 0.647 |  |
| 12:30 | 1 | 1.7% (0%-9%) | 5.4% | -3.7 | 0.964 |  | 0 | 0.0% (0%-6%) | 5.4% | -5.4 | 1.000 |  |
| 13:00 | 1 | 1.7% (0%-9%) | 5.4% | -3.7 | 0.968 |  | 2 | 3.3% (1%-11%) | 5.5% | -2.2 | 0.849 |  |
| 13:30 | 1 | 1.7% (0%-9%) | 5.6% | -3.9 | 0.968 |  | 0 | 0.0% (0%-6%) | 5.7% | -5.7 | 1.000 |  |
| 14:00 | 0 | 0.0% (0%-6%) | 5.9% | -5.9 | 1.000 |  | 0 | 0.0% (0%-6%) | 6.1% | -6.1 | 1.000 |  |
| 14:30 | 2 | 3.3% (1%-11%) | 6.4% | -3.1 | 0.906 |  | 0 | 0.0% (0%-6%) | 6.9% | -6.9 | 1.000 |  |
| 15:00 | 2 | 3.3% (1%-11%) | 7.8% | -4.4 | 0.954 |  | 4 | 6.7% (3%-16%) | 8.4% | -1.8 | 0.763 |  |
| 15:30 | 4 | 6.7% (3%-16%) | 14.7% | -8.0 | 0.991 |  | 7 | 11.7% (6%-22%) | 16.8% | -5.1 | 0.930 |  |

First or last 30 minutes (buckets 9:30 and 15:30): high 65.0% (Wilson 52%-76%; null 30.8%, null 95% range 20%-42%; p over <0.001); low 61.7% (49%-73%; null 31.2%, 20%-42%; p <0.001); high OR low in an edge bucket 88.3% (78%-94%; null 54.0%, 43%-65%; p <0.001).

#### GLD (60 sessions)
Chi-square-style statistic vs the shuffle null: high = 16.5 (permutation p 0.130), low = 24.7 (p 0.013).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 19 | 31.7% (21%-44%) | 16.2% | +15.5 | <0.001 | OVER | 16 | 26.7% (17%-39%) | 16.0% | +10.7 | 0.010 |  |
| 10:00 | 6 | 10.0% (5%-20%) | 8.0% | +2.0 | 0.348 |  | 9 | 15.0% (8%-26%) | 7.8% | +7.2 | 0.038 |  |
| 10:30 | 2 | 3.3% (1%-11%) | 6.6% | -3.3 | 0.916 |  | 7 | 11.7% (6%-22%) | 6.4% | +5.2 | 0.083 |  |
| 11:00 | 5 | 8.3% (4%-18%) | 6.0% | +2.4 | 0.283 |  | 6 | 10.0% (5%-20%) | 5.9% | +4.1 | 0.140 |  |
| 11:30 | 1 | 1.7% (0%-9%) | 5.6% | -4.0 | 0.970 |  | 1 | 1.7% (0%-9%) | 5.5% | -3.9 | 0.968 |  |
| 12:00 | 3 | 5.0% (2%-14%) | 5.5% | -0.5 | 0.645 |  | 4 | 6.7% (3%-16%) | 5.3% | +1.3 | 0.403 |  |
| 12:30 | 2 | 3.3% (1%-11%) | 5.3% | -2.0 | 0.840 |  | 0 | 0.0% (0%-6%) | 5.4% | -5.4 | 1.000 |  |
| 13:00 | 4 | 6.7% (3%-16%) | 5.4% | +1.3 | 0.404 |  | 0 | 0.0% (0%-6%) | 5.4% | -5.4 | 1.000 |  |
| 13:30 | 2 | 3.3% (1%-11%) | 5.6% | -2.3 | 0.859 |  | 4 | 6.7% (3%-16%) | 5.6% | +1.0 | 0.439 |  |
| 14:00 | 2 | 3.3% (1%-11%) | 5.8% | -2.5 | 0.878 |  | 2 | 3.3% (1%-11%) | 6.0% | -2.6 | 0.880 |  |
| 14:30 | 1 | 1.7% (0%-9%) | 6.5% | -4.8 | 0.984 |  | 3 | 5.0% (2%-14%) | 6.6% | -1.6 | 0.775 |  |
| 15:00 | 4 | 6.7% (3%-16%) | 7.8% | -1.2 | 0.707 |  | 3 | 5.0% (2%-14%) | 8.0% | -3.0 | 0.877 |  |
| 15:30 | 9 | 15.0% (8%-26%) | 15.7% | -0.7 | 0.633 |  | 5 | 8.3% (4%-18%) | 16.0% | -7.6 | 0.985 |  |

First or last 30 minutes (buckets 9:30 and 15:30): high 46.7% (Wilson 35%-59%; null 31.9%, null 95% range 22%-43%; p over 0.007); low 35.0% (24%-48%; null 32.0%, 20%-43%; p 0.349); high OR low in an edge bucket 70.0% (57%-80%; null 57.1%, 45%-68%; p 0.020).

#### All nine symbols pooled (540 sessions)
Chi-square-style statistic vs the shuffle null: high = 286.8 (permutation p <0.001), low = 287.8 (p <0.001).

| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9:30 | 229 | 42.4% (38%-47%) | 16.4% | +26.0 | <0.001 | OVER | 222 | 41.1% (37%-45%) | 16.1% | +25.0 | <0.001 | OVER |
| 10:00 | 46 | 8.5% (6%-11%) | 8.1% | +0.4 | 0.384 |  | 57 | 10.6% (8%-13%) | 7.8% | +2.8 | 0.012 |  |
| 10:30 | 25 | 4.6% (3%-7%) | 6.6% | -2.0 | 0.979 |  | 37 | 6.9% (5%-9%) | 6.4% | +0.5 | 0.350 |  |
| 11:00 | 29 | 5.4% (4%-8%) | 5.9% | -0.5 | 0.739 |  | 30 | 5.6% (4%-8%) | 5.7% | -0.2 | 0.599 |  |
| 11:30 | 26 | 4.8% (3%-7%) | 5.5% | -0.7 | 0.789 |  | 25 | 4.6% (3%-7%) | 5.4% | -0.8 | 0.818 |  |
| 12:00 | 22 | 4.1% (3%-6%) | 5.3% | -1.2 | 0.920 |  | 15 | 2.8% (2%-5%) | 5.2% | -2.5 | 0.998 |  |
| 12:30 | 12 | 2.2% (1%-4%) | 5.2% | -3.0 | 1.000 | UNDER | 11 | 2.0% (1%-4%) | 5.3% | -3.2 | 1.000 | UNDER |
| 13:00 | 16 | 3.0% (2%-5%) | 5.2% | -2.3 | 0.996 |  | 16 | 3.0% (2%-5%) | 5.3% | -2.4 | 0.996 |  |
| 13:30 | 10 | 1.9% (1%-3%) | 5.4% | -3.6 | 1.000 | UNDER | 10 | 1.9% (1%-3%) | 5.6% | -3.7 | 1.000 | UNDER |
| 14:00 | 14 | 2.6% (2%-4%) | 5.8% | -3.2 | 1.000 | UNDER | 17 | 3.1% (2%-5%) | 5.9% | -2.8 | 0.999 | UNDER |
| 14:30 | 15 | 2.8% (2%-5%) | 6.4% | -3.6 | 1.000 | UNDER | 15 | 2.8% (2%-5%) | 6.7% | -3.9 | 1.000 | UNDER |
| 15:00 | 25 | 4.6% (3%-7%) | 7.8% | -3.2 | 0.999 | UNDER | 26 | 4.8% (3%-7%) | 8.2% | -3.3 | 1.000 | UNDER |
| 15:30 | 71 | 13.1% (11%-16%) | 16.3% | -3.2 | 0.993 |  | 59 | 10.9% (9%-14%) | 16.4% | -5.5 | 1.000 | UNDER |

First or last 30 minutes (buckets 9:30 and 15:30): high 55.6% (Wilson 51%-60%; null 32.7%, null 95% range 29%-36%; p over <0.001); low 52.0% (48%-56%; null 32.5%, 29%-36%; p <0.001); high OR low in an edge bucket 84.6% (81%-87%; null 56.7%, 53%-61%; p <0.001).

### Supplement: same observed data against a null that keeps each slot's volatility (random bar direction)
The pre-registered shuffle moves the big opening and closing bars to random times, so part of its 'excess' is simply that volatility is highest at the open. This supplement keeps every bar in its own time slot and size and only randomises direction. Share of sessions with the extreme in each edge bucket, observed vs this null; flagged buckets use the same Bonferroni rule (p <= 0.05/13).

| Group | side | 9:30 obs (null) | 15:30 obs (null) | chi p | OVER buckets | UNDER buckets |
|---|---|---|---|---|---|---|
| SPY | high | 30% (29%) | 13% (17%) | 0.507 | none | none |
| SPY | low | 23% (28%) | 12% (17%) | 0.582 | none | none |
| QQQ | high | 35% (36%) | 17% (14%) | 0.504 | none | none |
| QQQ | low | 33% (35%) | 10% (14%) | 0.760 | none | none |
| NVDA | high | 47% (41%) | 12% (17%) | 0.319 | none | none |
| NVDA | low | 33% (41%) | 18% (17%) | 0.287 | none | none |
| DELL | high | 58% (50%) | 7% (13%) | 0.641 | none | none |
| DELL | low | 50% (50%) | 12% (13%) | 0.378 | none | none |
| GLD | high | 32% (28%) | 15% (12%) | 0.891 | none | none |
| GLD | low | 27% (28%) | 8% (12%) | 0.406 | none | none |
| POOLED9 | high | 42% (41%) | 13% (15%) | 0.611 | none | none |
| POOLED9 | low | 41% (41%) | 11% (15%) | 0.205 | none | none |

#### Wider pool, individually (summary only)
| Symbol | sessions | high chi p | low chi p | high flagged buckets | low flagged buckets |
|---|---|---|---|---|---|
| AAPL | 60 | <0.001 | <0.001 | 9:30 OVER | 9:30 OVER |
| MSFT | 60 | <0.001 | <0.001 | 9:30 OVER | 9:30 OVER |
| AMD | 60 | <0.001 | <0.001 | 9:30 OVER | 9:30 OVER |
| TSLA | 60 | <0.001 | <0.001 | 9:30 OVER | 9:30 OVER |

### Study B tables

Events: 75 bearish reversals (fresh high), 52 bullish reversals (fresh low), 127 pooled, on 52 distinct dates (60 dates in the sample); at most 6 reversals fall on a single date. Control 1 pool: 2026 fresh highs and 1792 fresh lows that were not reversals. Control 2: 127 matched random bars (0 events had no available unmatched control bar).

Reversals by symbol (high / low): SPY 10/11, QQQ 11/7, NVDA 6/7, DELL 8/3, GLD 13/7, AAPL 4/5, MSFT 4/2, AMD 8/6, TSLA 11/4

### Bearish key reversal at a fresh session high (positive = price fell)
| Horizon | n | mean signed return, bp (95% boot CI by date) | hit rate (Wilson) | control 1 matched mean, bp | diff vs control 1, bp (CI) | raw p | BH p | control 2 matched mean, bp | diff vs control 2, bp (CI) | raw p | BH p |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 15m | 75 | 1.67 (-5.6 to 8.8) | 54.7% (43%-65%) | 0.64 | 1.03 (-9.5 to 7.9) | 0.829 | 0.990 | 6.40 | -4.73 (-20.6 to 8.7) | 0.411 | 0.990 |
| 30m | 75 | -2.14 (-14.1 to 10.4) | 52.0% (41%-63%) | -0.37 | -1.77 (-16.8 to 9.3) | 0.776 | 0.990 | 6.73 | -8.87 (-30.3 to 9.7) | 0.319 | 0.990 |
| 60m | 64 | 4.39 (-9.5 to 19.1) | 51.6% (40%-63%) | -1.24 | 5.64 (-12.1 to 19.3) | 0.503 | 0.990 | 8.75 | -4.35 (-29.5 to 18.2) | 0.667 | 0.990 |
| to close | 75 | 8.94 (-12.6 to 31.9) | 48.0% (37%-59%) | 3.18 | 5.76 (-15.3 to 26.0) | 0.600 | 0.990 | 36.96 | -28.02 (-68.8 to 8.1) | 0.081 | 0.990 |

Extreme holds for the next 30 minutes (descriptive; uncorrected): reversal 62.7% (Wilson 51%-73%, n 75) vs control 1 matched 22.5% (diff 40.1 pp, CI 31.5 to 49.6, p <0.001) and control 2 matched 26.7% (diff 36.0 pp, CI 18.6 to 57.1, p <0.001).
Was the reversal bar the realised session high? 29 of 75 = 38.7% (Wilson 28%-50%). For comparison, plain fresh extremes that were not reversals: 211 of 2026 = 10.4% (9%-12%).

### Bullish key reversal at a fresh session low (positive = price rose)
| Horizon | n | mean signed return, bp (95% boot CI by date) | hit rate (Wilson) | control 1 matched mean, bp | diff vs control 1, bp (CI) | raw p | BH p | control 2 matched mean, bp | diff vs control 2, bp (CI) | raw p | BH p |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 15m | 52 | 1.63 (-9.7 to 10.4) | 55.8% (42%-68%) | 3.39 | -1.76 (-15.4 to 7.0) | 0.691 | 0.990 | 4.34 | -2.71 (-18.9 to 14.2) | 0.619 | 0.990 |
| 30m | 52 | 4.34 (-8.7 to 16.9) | 51.9% (39%-65%) | 4.41 | -0.07 (-14.2 to 10.7) | 0.990 | 0.990 | 13.78 | -9.44 (-29.8 to 9.1) | 0.170 | 0.990 |
| 60m | 49 | 8.37 (-6.7 to 24.3) | 51.0% (37%-64%) | 8.84 | -0.47 (-20.0 to 15.2) | 0.949 | 0.990 | 5.80 | 2.58 (-19.9 to 39.8) | 0.804 | 0.990 |
| to close | 52 | 18.93 (4.2 to 34.5) | 55.8% (42%-68%) | 18.45 | 0.48 (-25.0 to 18.2) | 0.962 | 0.990 | 18.68 | 0.25 (-27.9 to 40.5) | 0.984 | 0.990 |

Extreme holds for the next 30 minutes (descriptive; uncorrected): reversal 71.2% (Wilson 58%-82%, n 52) vs control 1 matched 25.3% (diff 45.9 pp, CI 31.8 to 61.7, p <0.001) and control 2 matched 40.4% (diff 30.8 pp, CI 5.9 to 56.8, p 0.002).
Was the reversal bar the realised session low? 22 of 52 = 42.3% (Wilson 30%-56%). For comparison, plain fresh extremes that were not reversals: 237 of 1792 = 13.2% (12%-15%).

### Both directions pooled (positive = reversal worked); p values here are outside the corrected family
| Horizon | n | mean signed return, bp (95% boot CI by date) | hit rate (Wilson) | control 1 matched mean, bp | diff vs control 1, bp (CI) | raw p | BH p | control 2 matched mean, bp | diff vs control 2, bp (CI) | raw p | BH p |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 15m | 127 | 1.65 (-5.6 to 8.1) | 55.1% (46%-63%) | 1.76 | -0.11 (-10.2 to 5.8) | 0.975 | - | 5.55 | -3.90 (-15.3 to 6.4) | 0.339 | - |
| 30m | 127 | 0.51 (-9.8 to 11.2) | 52.0% (43%-60%) | 1.59 | -1.07 (-13.4 to 7.8) | 0.795 | - | 9.62 | -9.10 (-24.3 to 4.7) | 0.123 | - |
| 60m | 113 | 6.12 (-4.1 to 17.0) | 51.3% (42%-60%) | 3.13 | 2.99 (-10.1 to 12.9) | 0.587 | - | 7.47 | -1.35 (-18.5 to 19.4) | 0.843 | - |
| to close | 127 | 13.03 (-3.1 to 28.8) | 51.2% (43%-60%) | 9.43 | 3.60 (-14.4 to 18.0) | 0.637 | - | 29.48 | -16.45 (-42.7 to 11.0) | 0.132 | - |

Extreme holds for the next 30 minutes (descriptive; uncorrected): reversal 66.1% (Wilson 58%-74%, n 127) vs control 1 matched 23.7% (diff 42.5 pp, CI 34.4 to 52.3, p <0.001) and control 2 matched 32.3% (diff 33.9 pp, CI 20.1 to 51.0, p <0.001).
Was the reversal bar the realised session extreme? 51 of 127 = 40.2% (Wilson 32%-49%). For comparison, plain fresh extremes that were not reversals: 448 of 3818 = 11.7% (11%-13%).

### Multiple-testing family (2 directions x 4 horizons x 2 controls = 16)
| Direction | Horizon | Control | raw p | BH-adjusted p |
|---|---|---|---|---|
| high | 15m | 1 (fresh extreme, no reversal) | 0.829 | 0.990 |
| high | 15m | 2 (random bar) | 0.411 | 0.990 |
| high | 30m | 1 (fresh extreme, no reversal) | 0.776 | 0.990 |
| high | 30m | 2 (random bar) | 0.319 | 0.990 |
| high | 60m | 1 (fresh extreme, no reversal) | 0.503 | 0.990 |
| high | 60m | 2 (random bar) | 0.667 | 0.990 |
| high | to close | 1 (fresh extreme, no reversal) | 0.600 | 0.990 |
| high | to close | 2 (random bar) | 0.081 | 0.990 |
| low | 15m | 1 (fresh extreme, no reversal) | 0.691 | 0.990 |
| low | 15m | 2 (random bar) | 0.619 | 0.990 |
| low | 30m | 1 (fresh extreme, no reversal) | 0.990 | 0.990 |
| low | 30m | 2 (random bar) | 0.170 | 0.990 |
| low | 60m | 1 (fresh extreme, no reversal) | 0.949 | 0.990 |
| low | 60m | 2 (random bar) | 0.804 | 0.990 |
| low | to close | 1 (fresh extreme, no reversal) | 0.962 | 0.990 |
| low | to close | 2 (random bar) | 0.984 | 0.990 |

### By time of day (descriptive, not part of the corrected family)
| Window | Direction | n | mean 15m | mean 30m | mean 60m | mean to close | hit rate 30m | control 2 matched mean 30m | diff 30m | realised extreme |
|---|---|---|---|---|---|---|---|---|---|---|
| 10:00-11:30 | high | 35 | 0.9 | 0.7 | 2.5 (n 35) | 9.3 | 51% | 12.5 | -11.9 | 13/35 (37%) |
| 10:00-11:30 | low | 25 | 2.9 | 2.0 | 18.3 (n 25) | 17.1 | 48% | 12.9 | -11.0 | 12/25 (48%) |
| 10:00-11:30 | pooled | 60 | 1.7 | 1.2 | 9.1 (n 60) | 12.5 | 50% | 12.7 | -11.5 | 25/60 (42%) |
| 11:30-14:00 | high | 22 | 2.3 | -0.5 | 6.2 (n 22) | 10.4 | 55% | 2.4 | -2.9 | 8/22 (36%) |
| 11:30-14:00 | low | 21 | -6.3 | -6.1 | -1.7 (n 21) | 20.0 | 48% | 6.0 | -12.1 | 6/21 (29%) |
| 11:30-14:00 | pooled | 43 | -1.9 | -3.2 | 2.4 (n 43) | 15.1 | 51% | 4.2 | -7.4 | 14/43 (33%) |
| 14:00-15:30 | high | 18 | 2.4 | -9.6 | 8.0 (n 7) | 6.5 | 50% | 0.7 | -10.3 | 8/18 (44%) |
| 14:00-15:30 | low | 6 | 24.4 | 50.5 | -4.0 (n 3) | 22.7 | 83% | 44.4 | 6.1 | 4/6 (67%) |
| 14:00-15:30 | pooled | 24 | 7.9 | 5.4 | 4.4 (n 10) | 10.5 | 58% | 11.6 | -6.2 | 12/24 (50%) |

### By symbol (descriptive; mean signed return in bp, both directions pooled)
| Symbol | n | 15m | 30m | 60m | to close |
|---|---|---|---|---|---|
| SPY | 21 | -0.7 | -1.8 | -0.6 | -3.9 |
| QQQ | 18 | 7.1 | 13.6 | 1.6 | 17.2 |
| NVDA | 13 | 2.8 | 8.6 | 14.0 | 3.3 |
| DELL | 11 | 2.9 | -11.0 | 29.2 | 70.1 |
| GLD | 20 | 2.5 | 4.7 | 6.5 | 21.7 |
| AAPL | 9 | -3.0 | -12.6 | -16.1 | -13.9 |
| MSFT | 6 | 28.5 | 37.5 | 50.5 | -2.8 |
| AMD | 14 | -10.9 | -8.2 | -7.9 | 2.3 |
| TSLA | 15 | -1.0 | -14.8 | 6.1 | 19.2 |

### Cost context (no costs are deducted anywhere above)
Assumed round-trip cost: about 1 bp for SPY and about 3 bp for the other symbols (spread plus slippage at typical liquid-name quotes; your actual fills will differ). Pooled mean signed return of the reversal: 15m 1.7 bp, 30m 0.5 bp, 60m 6.1 bp, to close 13.0 bp. Pooled excess over matched random bars (control 2): 15m -3.9 bp, 30m -9.1 bp, 60m -1.3 bp, to close -16.4 bp.

## 3. Plain-language reading

1. Timing (Study A): across the nine symbols about 42% of session highs and 41% of session lows are set in the first 30 minutes, and 13% and 11% in the last 30; 12:30 to 15:00 is thin (2% to 5% per bucket). Against the pre-registered shuffle null the 9:30 bucket is OVER for QQQ, NVDA, DELL (high and low), GLD (high) and for every wider-pool symbol, SPY is not flagged individually (its 60-session counts are small), and the midday and 14:00-15:30 buckets are UNDER when pooled.
2. That excess is the volatility profile, not extra reversal timing. Against the supplementary null that keeps each time slot's volatility, nothing is flagged for any symbol or the pool (pooled 9:30 share 42% observed vs 41% expected, all chi-square p above 0.2). So the honest statement is: highs and lows form at the open and the close because that is where the bars are big, and the data show no further clustering beyond that.
3. About 85% of sessions have the high or low in the first or last 30 minutes (pooled), which a random walk with this volatility profile also produces. Any "time the reversal for the usual extreme times" idea therefore concentrates on the first and last half hour, but those windows are not special beyond their size.
4. Reversals (Study B): 127 key reversals (75 at highs, 52 at lows) on 52 of the 60 dates. Mean signed return pooled: 1.7 bp at 15 min, 0.5 bp at 30 min (95% CI -9.8 to 11.2), 6.1 bp at 60 min, 13.0 bp to the close; hit rates 51% to 55% with intervals that include 50%.
5. Against matched controls the answer is null: all 16 Benjamini-Hochberg-adjusted p-values are 0.99, the smallest raw p is 0.081 (bearish, to close, vs random bars, where the reversal did worse than random). The positive drift to the close is market drift in this window (control 1 shows 9 bp). With 127 events the 30-minute interval is about plus or minus 10 bp, so effects smaller than that cannot be ruled out, but none is visible.
6. "Extreme holds" is 66% for reversals against 24% to 32% for controls, but this is largely mechanical: the reversal bar closes well off its high, so there is more room before the high is exceeded than for a fresh high that closes at the high. It did not translate into a better return.
7. How often is the reversal the real extreme? 40% (51 of 127; Wilson 32% to 49%), against 11.7% for plain fresh extremes after 10:00. So a key reversal marks the true high or low about four times in ten, much better than a random fresh extreme but wrong six times in ten.
8. Costs: the round trip is about 1 bp (SPY) and 3 bp (others); the pooled mean signed returns (0.5 to 13 bp) have intervals spanning zero and are no better than matched controls, so no edge over cost is demonstrated. Per-symbol means are descriptive and based on 6 to 21 events each.
9. For the framework: on price alone, a key reversal at a fresh session extreme is a useful label (it is the real extreme 40% of the time) but not a standalone gate with demonstrated forward edge. Whether option, put/call or flow confluence changes that is untested here.

## 4. Caveats

- Sample: 60 sessions per symbol (2026-07-23 to 2026-10-15), one regime. 127 events is small; the pooled intervals are wide and the per-symbol and per-window tables rest on 3 to 60 events and are descriptive only.
- Yahoo data: free feed, 5-minute bars, volume about 78% of consolidated (not used here), no corporate-action or bad-tick audit beyond dropping bars with missing prices. All nine symbols returned the same number of bars (4,681), which is plausible for a clean calendar but was not cross-checked against another source.
- Correlated symbols: the nine symbols trade the same days. The date-clustered bootstrap respects that; the permutation tests (which shuffle labels within symbol and bucket) and the Study A pooled chi-square p-values treat sessions as independent and are therefore too optimistic. They do not change the conclusion, which is null for reversals and explained by volatility for timing.
- Study A null: bars are shuffled as units and chained close to next open, ignoring the small gaps between one bar's close and the next bar's open. The pre-registered null conflates time-of-day volatility with timing (see the supplement). Ties for the high or low go to the first bar.
- Study B: the 60-minute horizon has 113 of 127 events because late events run past the close. Hit rates are for the signed return strictly above zero. Reversals cluster by date (up to 6 on one day).
- No costs and no entry rule: returns are measured from the reversal bar's close, which would need to be filled at that price. Costs are only compared against the mean returns above in the plain-language section.
- Multiple testing: Benjamini-Hochberg over 16 tests; the time-of-day, per-symbol, pooled-direction and extreme-holds comparisons are outside that family and uncorrected.
- The supplementary Study A null was added after seeing the first Study A result (disclosed in section 1).
