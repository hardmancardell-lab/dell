import { NextResponse } from "next/server";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { chartCacheSeconds, parseChartBarsQuery, safeChartError } from "@/lib/chart/chart-bars-query";
import { TtlCache } from "@/lib/news/news-core";
import { getChartBars, getChartEvents, type ChartBarsResult } from "@/lib/agents/trading-agent/skills/chart-bars";
import type { CorporateEventsResult } from "@/lib/data/market-data-types";

export const maxDuration = 30;

// Best effort, per server instance (see lib/access/rate-limit.ts). A chart opens three requests (bars, compare symbol,
// events) and a person flicking through timeframes makes a handful more, so 120 a minute per address leaves normal use
// untouched while stopping a script that walks through symbols.
const limiter = new SlidingWindowLimiter(120, 60_000);

// Short server-side cache with in-flight de-duplication: the same chart asked for twice inside the window costs the data
// providers one call. Failures are never stored. Intraday bars live 15 s, everything else 60 s.
const barsShortCache = new TtlCache<ChartBarsResult>(15_000, 150);
const barsLongCache = new TtlCache<ChartBarsResult>(60_000, 150);
const eventsCache = new TtlCache<CorporateEventsResult>(300_000, 150);

// At most this many provider loads at once on one instance; further uncached requests wait their turn by being turned
// away with a retry hint instead of piling up.
const MAX_LOADS_AT_ONCE = 12;
let loadsNow = 0;

async function withLoadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (loadsNow >= MAX_LOADS_AT_ONCE) throw new BusyError();
  loadsNow += 1;
  try {
    return await fn();
  } finally {
    loadsNow -= 1;
  }
}
class BusyError extends Error {}

/**
 * GET /api/chart-bars?ticker=AAPL&timeframe=1yr[&centerDate=YYYY-MM-DD][&adjustment=raw|split|all][&events=1]
 *
 * Read only market data. It stays reachable without a sign-in on purpose: PriceChart is also shown inside the public client
 * dashboard (/client/[slug]), which has no Supabase session (see src/middleware.ts). The site access password still applies
 * when it is set. Protection here is therefore a strict query check, a per-address limit, a work cap and a short cache.
 */
export async function GET(request: Request) {
  const d = limiter.hit(`chartbars|${clientIp(request)}`);
  if (!d.allowed) return tooManyRequests(d, "Too many chart requests. Wait a moment and try again.");

  const parsed = parseChartBarsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: { "cache-control": "no-store" } });
  const q = parsed.query;
  const headers = { "cache-control": `private, max-age=${chartCacheSeconds(q)}` };

  try {
    // ?events=1 returns the split and dividend markers for the same window instead of bars (kept on this route so no new public path is needed).
    if (q.events) {
      const key = `${q.ticker.toUpperCase()}|${q.timeframe}|${q.centerDate ?? ""}`;
      return NextResponse.json(await eventsCache.get(key, () => withLoadSlot(() => getChartEvents(q.ticker, q.timeframe, q.centerDate))), { headers });
    }
    const key = `${q.ticker.toUpperCase()}|${q.timeframe}|${q.centerDate ?? ""}|${q.adjustment}`;
    const cache = chartCacheSeconds(q) <= 15 ? barsShortCache : barsLongCache;
    const result = await cache.get(key, () => withLoadSlot(() => getChartBars(q.ticker, q.timeframe, q.centerDate, q.adjustment)));
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof BusyError) {
      return NextResponse.json({ error: "The chart service is busy. Try again in a few seconds." }, { status: 503, headers: { "retry-after": "3", "cache-control": "no-store" } });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: safeChartError(message) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
