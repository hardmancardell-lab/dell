import { NextResponse } from "next/server";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";
import type { PortfolioHolding } from "@/lib/agents/trading-agent/types";

// POST, not GET — same rationale as watchlist-scan/route.ts: holdings are a
// list of objects that don't fit a query string, and they live in the
// client's localStorage (no server persistence), so they travel in the body.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { holdings?: PortfolioHolding[] };
    if (!body.holdings || !Array.isArray(body.holdings)) {
      return NextResponse.json({ error: "Request body must include a 'holdings' array." }, { status: 400 });
    }
    const summary = await valuatePortfolio(body.holdings);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
