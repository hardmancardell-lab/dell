import type { SchwabCandle, SchwabOptionContract, SchwabOptionsChain, SchwabQuote } from "./schwab";

/**
 * Synthetic data for exercising the trading-agent pipeline (PM-volume
 * anomaly detection, historical composite, options chain) before Schwab
 * app approval completes. Enabled via SCHWAB_MOCK_MODE=true in .env.local.
 * Deliberately generated in a fixed-offset (EST, non-DST) month so the
 * hardcoded ET_OFFSET_HOURS below round-trips correctly through the real
 * DST-aware time-windows.ts conversion — this shortcut is fine for
 * synthetic test data but would be wrong for real market data (which is
 * why the real schwab.ts client uses Intl.DateTimeFormat instead).
 */

const ET_OFFSET_HOURS = 5; // EST

function etToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour + ET_OFFSET_HOURS, minute);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromSymbol(symbol: string): number {
  return symbol.split("").reduce((acc, c) => acc + c.charCodeAt(0), 7);
}

export function generateMockMinuteBars(symbol: string, startMs: number, endMs: number): SchwabCandle[] {
  const rand = mulberry32(seedFromSymbol(symbol));
  const candles: SchwabCandle[] = [];
  let price = 80 + (seedFromSymbol(symbol) % 120);

  // Iterate weekdays in January 2026 (fixed EST month, no DST edge cases)
  // — a fixed reference range regardless of the requested startMs/endMs,
  // since this is synthetic data meant to exercise the pipeline, not
  // reflect real dates. ~20 trading days is enough for the rolling
  // average window plus a handful of historical anomaly days.
  const dayCount = Math.max(20, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
  let day = 5; // Mon Jan 5, 2026
  let daysGenerated = 0;
  let dayIndex = 0;

  while (daysGenerated < dayCount && day < 5 + dayCount * 2) {
    const date = new Date(Date.UTC(2026, 0, day));
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) {
      day += 1;
      continue;
    }

    // The final generated day is always an anomaly so the mock deterministically
    // exercises both the live-check and historical-composite UI paths
    // regardless of ticker/seed. The 20 days immediately before it stay
    // clean (no random anomalies) so they serve as an undiluted rolling-
    // average baseline — otherwise a randomly-anomalous day inside that
    // trailing window inflates the average and can mask today's forced
    // anomaly. Earlier "deep history" days get deterministic anomalies
    // (every 6th day) so historical-composite.ts's own day-by-day scan has
    // a reliable sample to aggregate over.
    const isLastDay = daysGenerated === dayCount - 1;
    const isInCleanBaselineWindow = daysGenerated >= dayCount - 21 && !isLastDay;
    const isDeepHistory = dayIndex >= 20 && !isInCleanBaselineWindow && !isLastDay;
    const isAnomalyDay = isLastDay || (isDeepHistory && dayIndex % 6 === 0);
    const pmMultiplier = isAnomalyDay ? 4.5 + rand() * 3 : 0.6 + rand() * 0.8;
    const baseVolume = 400 + rand() * 300;
    const directionBias = rand() < 0.55 ? 1 : -1;
    const dayDrift = directionBias * (isAnomalyDay ? 0.15 + rand() * 0.3 : rand() * 0.1);

    // Premarket: 4:00-9:30 ET (330 minutes)
    for (let m = 0; m < 330; m++) {
      const hour = 4 + Math.floor(m / 60);
      const minute = m % 60;
      const vol = Math.max(1, Math.round(baseVolume * pmMultiplier * (0.5 + rand())));
      const open = price;
      price += (rand() - 0.5) * 0.05;
      candles.push({
        datetime: etToUtcMs(2026, 1, day, hour, minute),
        open,
        high: Math.max(open, price) + rand() * 0.05,
        low: Math.min(open, price) - rand() * 0.05,
        close: price,
        volume: vol,
      });
    }

    // Regular session: 9:30-16:00 ET (390 minutes), with a drift applied
    // smoothly across the session so checkpoint returns are non-degenerate.
    for (let m = 0; m < 390; m++) {
      const totalMin = 570 + m; // 9:30 = 570 min since midnight
      const hour = Math.floor(totalMin / 60);
      const minute = totalMin % 60;
      const sessionProgress = m / 390;
      const vol = Math.max(1, Math.round(baseVolume * (1.5 + rand()) * (m < 15 || m > 375 ? 1.8 : 1)));
      const open = price;
      price += dayDrift / 390 + (rand() - 0.5) * 0.08;
      void sessionProgress;
      candles.push({
        datetime: etToUtcMs(2026, 1, day, hour, minute),
        open,
        high: Math.max(open, price) + rand() * 0.06,
        low: Math.min(open, price) - rand() * 0.06,
        close: price,
        volume: vol,
      });
    }

    daysGenerated += 1;
    dayIndex += 1;
    day += 1;
  }

  return candles;
}

/**
 * Daily bars for the watchlist scan signals. Deterministically forces the
 * final 3 trading days into a green-close + rising-volume sequence (so
 * Momentum reliably triggers for any ticker/seed), with an extra volume
 * multiplier stacked on the very last day (so Volume Displacement reliably
 * triggers too) — same "always exercise both code paths regardless of seed"
 * philosophy as generateMockMinuteBars' forced final-day anomaly.
 */
export function generateMockDailyBars(symbol: string, startMs: number, endMs: number): SchwabCandle[] {
  const rand = mulberry32(seedFromSymbol(symbol) + 3);
  const candles: SchwabCandle[] = [];
  let price = 80 + (seedFromSymbol(symbol) % 120);
  const baseVolume = 500_000 + rand() * 500_000;

  const dayCount = Math.max(25, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
  let day = 5; // Mon Jan 5, 2026 — fixed EST reference month, see module note above
  let daysGenerated = 0;

  while (daysGenerated < dayCount && day < 5 + dayCount * 2) {
    const date = new Date(Date.UTC(2026, 0, day));
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) {
      day += 1;
      continue;
    }

    const isLastDay = daysGenerated === dayCount - 1;
    const isMomentumWindow = daysGenerated >= dayCount - 3;
    const open = price;
    let close: number;
    let volume: number;

    if (isMomentumWindow) {
      const stepIndex = daysGenerated - (dayCount - 3); // 0, 1, 2
      close = open * (1 + 0.006 + rand() * 0.004); // guaranteed small green move
      volume = baseVolume * (1.2 + stepIndex * 0.4) * (isLastDay ? 4.5 : 1);
    } else {
      close = open + (rand() - 0.5) * open * 0.01;
      volume = baseVolume * (0.7 + rand() * 0.6);
    }

    candles.push({
      datetime: etToUtcMs(2026, 1, day, 16, 0), // market close timestamp for a daily bar
      open,
      high: Math.max(open, close) * (1 + rand() * 0.003),
      low: Math.min(open, close) * (1 - rand() * 0.003),
      close,
      volume: Math.round(volume),
    });

    price = close;
    daysGenerated += 1;
    day += 1;
  }

  return candles;
}

export function generateMockQuote(symbol: string): SchwabQuote {
  const rand = mulberry32(seedFromSymbol(symbol) + 1);
  return {
    symbol,
    lastPrice: 80 + (seedFromSymbol(symbol) % 120) + rand() * 5,
    totalVolume: Math.round(500_000 + rand() * 2_000_000),
  };
}

export function generateMockOptionsChain(symbol: string): SchwabOptionsChain {
  const rand = mulberry32(seedFromSymbol(symbol) + 2);
  const basePrice = 80 + (seedFromSymbol(symbol) % 120);
  const calls: SchwabOptionContract[] = [];
  const puts: SchwabOptionContract[] = [];

  // Computed relative to "now" (not a hardcoded past date) so time-to-expiration
  // stays positive regardless of when this mock is actually run — a stale
  // fixed date previously made T<=0, which silently zeroed out any
  // time-value-sensitive math (e.g. gex-signal.ts's Black-Scholes gamma).
  const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (let i = -5; i <= 5; i++) {
    const strikePrice = Math.round(basePrice + i * 5);
    const base: Omit<SchwabOptionContract, "openInterest" | "totalVolume" | "delta"> = {
      strikePrice,
      expirationDate,
      daysToExpiration: 30,
      bid: Math.max(0.05, 3 - Math.abs(i) * 0.4),
      ask: Math.max(0.1, 3.2 - Math.abs(i) * 0.4),
      last: Math.max(0.05, 3 - Math.abs(i) * 0.4),
      volatility: 25 + rand() * 10,
      gamma: 0.02,
      theta: -0.05,
      vega: 0.1,
    };
    calls.push({
      ...base,
      openInterest: Math.round(500 + rand() * 5000),
      totalVolume: Math.round(50 + rand() * 2000),
      delta: 0.5 - i * 0.08,
    });
    puts.push({
      ...base,
      openInterest: Math.round(500 + rand() * 5000),
      totalVolume: Math.round(50 + rand() * 2000),
      delta: -0.5 - i * 0.08,
    });
  }

  return { symbol, calls, puts };
}
