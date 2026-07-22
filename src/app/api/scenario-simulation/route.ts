import { NextResponse } from "next/server";
import { runScenarioSimulation } from "@/lib/agents/trading-agent/skills/scenario-simulation";
import type { PortfolioHolding } from "@/lib/agents/trading-agent/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { holdings?: PortfolioHolding[]; horizonYears?: number };
    if (!body.holdings || !Array.isArray(body.holdings)) {
      return NextResponse.json({ error: "Request body must include a 'holdings' array." }, { status: 400 });
    }
    const result = await runScenarioSimulation(body.holdings, body.horizonYears);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
