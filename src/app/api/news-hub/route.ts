import { NextResponse } from "next/server";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { getMarketNews, getTickerNews, getWatchlistNews, MAX_WATCHLIST_SYMBOLS } from "@/lib/news/news-hub";
import { isHubSymbol } from "@/lib/news/news-core";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

export const maxDuration = 60;

const VALID_ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity", "crypto"];
// Best effort, per server instance (see lib/access/rate-limit.ts). Results are also cached for minutes in news-hub.ts.
const limiter = new SlidingWindowLimiter(40, 60_000);
const CACHE_HEADERS = { "cache-control": "private, max-age=60" };

function limited(request: Request): Response | null {
  const d = limiter.hit(`hub|${clientIp(request)}`);
  return d.allowed ? null : tooManyRequests(d, "Too many news requests. Wait a moment and try again.");
}

/**
 * GET /api/news-hub?section=market
 * GET /api/news-hub?section=ticker&ticker=AAPL&assetClass=equity[&background=1]
 * Needs a signed-in session like every other app route (src/middleware.ts).
 */
export async function GET(request: Request) {
  const blocked = limited(request);
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section");
  try {
    if (section === "market") {
      return NextResponse.json(await getMarketNews(), { headers: CACHE_HEADERS });
    }
    if (section === "ticker") {
      const ticker = searchParams.get("ticker");
      const assetClass = searchParams.get("assetClass") ?? "equity";
      if (!isHubSymbol(ticker)) return NextResponse.json({ error: "Enter a ticker with letters and numbers only." }, { status: 400 });
      if (!VALID_ASSET_CLASSES.includes(assetClass as AssetClass)) return NextResponse.json({ error: "Unknown asset type." }, { status: 400 });
      const background = searchParams.get("background") === "1";
      return NextResponse.json(await getTickerNews(ticker, assetClass as AssetClass, background), { headers: CACHE_HEADERS });
    }
    return NextResponse.json({ error: "Use section=market or section=ticker." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "News could not be loaded right now. Try again in a few minutes." }, { status: 500 });
  }
}

/** POST /api/news-hub  body { entries: [{ symbol, assetClass }] }  (the watchlist section) */
export async function POST(request: Request) {
  const blocked = limited(request);
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.entries)) return NextResponse.json({ error: "Send { entries: [{ symbol, assetClass }] }." }, { status: 400 });
  if (body.entries.length > MAX_WATCHLIST_SYMBOLS * 10) return NextResponse.json({ error: "That list is too long." }, { status: 400 });
  try {
    const entries = body.entries.map((e: { symbol?: unknown; assetClass?: unknown }) => ({ symbol: String(e?.symbol ?? ""), assetClass: String(e?.assetClass ?? "") as AssetClass }));
    return NextResponse.json(await getWatchlistNews(entries), { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ error: "News could not be loaded right now. Try again in a few minutes." }, { status: 500 });
  }
}
