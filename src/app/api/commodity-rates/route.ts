import { NextResponse } from "next/server";
import { getTopCommodityRates } from "@/lib/agents/trading-agent/skills/commodity-rates";

export async function GET() {
  try {
    const result = await getTopCommodityRates();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
