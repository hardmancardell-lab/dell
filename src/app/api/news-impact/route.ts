import { NextResponse } from "next/server";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { getNewsImpact } from "@/lib/news-impact/data";
import { isHubSymbol } from "@/lib/news/news-core";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

export const maxDuration = 60;

const VALID_ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity", "crypto"];
// Best effort, per server instance (see lib/access/rate-limit.ts). The result is also cached for six hours in data.ts,
// and each uncached run makes several provider calls, so this limit is tighter than the news-hub one.
const limiter = new SlidingWindowLimiter(12, 60_000);
const CACHE_HEADERS = { "cache-control": "private, max-age=300" };

/**
 * GET /api/news-impact?ticker=AAPL&assetClass=equity
 * Read only. How much do dated company events and scheduled macro days move this asset, and how much of its movement is
 * market-wide? Needs a signed-in session like every other app route (src/middleware.ts; this path is not on the public
 * list). Research and education, not advice: it reports what moved with what, never what caused it.
 */
export async function GET(request: Request) {
  const d = limiter.hit(`impact|${clientIp(request)}`);
  if (!d.allowed) return tooManyRequests(d, "Too many News Impact requests. Wait a moment and try again.");
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const assetClass = searchParams.get("assetClass") ?? "equity";
  if (!isHubSymbol(ticker)) return NextResponse.json({ error: "Enter a ticker with letters and numbers only." }, { status: 400 });
  if (!VALID_ASSET_CLASSES.includes(assetClass as AssetClass)) return NextResponse.json({ error: "Unknown asset type." }, { status: 400 });
  try {
    return NextResponse.json(await getNewsImpact(ticker, assetClass as AssetClass), { headers: CACHE_HEADERS });
  } catch (e) {
    // Messages from data.ts name the provider and the symbol only; anything else becomes a generic sentence.
    const msg = e instanceof Error && /^Prices for [A-Za-z0-9.^=/_-]{1,20} could not be loaded\.$/.test(e.message) ? e.message : null;
    return NextResponse.json(
      { error: msg ? `${msg} Check the symbol, or try again in a few minutes.` : "The News Impact study could not run right now. Try again in a few minutes." },
      { status: msg ? 502 : 500 }
    );
  }
}
