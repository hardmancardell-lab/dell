import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyClientCookie } from "@/lib/access/tokens";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { isValidId } from "@/lib/data/postgrest-safe";
import { getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { getWatchlistNews, type WatchlistInput } from "@/lib/news/news-hub";
import { isHubSymbol } from "@/lib/news/news-core";

export const maxDuration = 60;

// Best effort, per server instance. Keyed on address and client link so one client cannot be used to spend another's budget.
const limiter = new SlidingWindowLimiter(20, 60_000);

/**
 * Read-only news for ONE client's holdings. Same access pattern as ./dashboard: /api/client/* skips the Supabase
 * session in src/middleware.ts, so this handler checks the link id, the client row and the signed passcode cookie
 * itself, in that order, before reading any holding.
 *
 * Clients have holdings but no watchlist in the data model (only advisor_client_holdings exists), so the news is for
 * the symbols they hold. Option holdings use the underlying symbol. Bonds and options without an underlying are left out.
 * The response carries symbols, headlines and links only: no quantities, prices, cost basis or other client data.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidId(slug)) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const decision = limiter.hit(`${clientIp(request)}|${slug.slice(0, 64)}`);
  if (!decision.allowed) return tooManyRequests(decision, "Too many news requests. Wait a moment and try again.");

  const client = await getAdvisorClientBySlug(slug);
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const cookieStore = await cookies();
  const session = cookieStore.get(`client_session_${slug}`)?.value;
  if (!(await verifyClientCookie(slug, client.passcodeHash, session))) {
    return NextResponse.json({ error: "Passcode required.", requiresPasscode: true }, { status: 401 });
  }

  try {
    const holdings = await listClientHoldings(client.id);
    const entries: WatchlistInput[] = [];
    const left: string[] = [];
    for (const h of holdings) {
      const symbol = h.assetClass === "option" ? (h.underlyingSymbol ?? "") : h.symbol;
      const assetClass = h.assetClass === "option" ? "equity" : h.assetClass;
      if (!symbol || !isHubSymbol(symbol)) {
        left.push(h.symbol);
        continue;
      }
      entries.push({ symbol, assetClass });
    }
    const section = await getWatchlistNews(entries);
    if (holdings.length === 0) section.error = "No holdings are on file yet, so there is no news to show.";
    return NextResponse.json({ holdingsCount: holdings.length, leftOut: left.length + section.skipped.length, ...section }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "News could not be loaded right now. Try again in a few minutes." }, { status: 500 });
  }
}
