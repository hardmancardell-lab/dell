import { NextResponse } from "next/server";
import { runPortfolioShockScan } from "@/lib/agents/trading-agent/skills/portfolio-shock-scan";
import type { PortfolioHolding } from "@/lib/agents/trading-agent/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { holdings?: PortfolioHolding[] };
    if (!Array.isArray(body.holdings) || body.holdings.length === 0) {
      return NextResponse.json({ error: "Request body must include a non-empty 'holdings' array." }, { status: 400 });
    }
    const result = await runPortfolioShockScan(body.holdings);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
