import { NextResponse } from "next/server";
import { runPortfolioAnalytics } from "@/lib/agents/trading-agent/skills/portfolio-analytics";
import type { PortfolioHolding } from "@/lib/agents/trading-agent/types";

// POST — same rationale as watchlist-scan/route.ts and portfolio-valuation/route.ts.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { holdings?: PortfolioHolding[] };
    if (!body.holdings || !Array.isArray(body.holdings)) {
      return NextResponse.json({ error: "Request body must include a 'holdings' array." }, { status: 400 });
    }
    const result = await runPortfolioAnalytics(body.holdings);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
