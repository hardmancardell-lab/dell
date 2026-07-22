import { NextResponse } from "next/server";
import { getCurrencyExpertAnalysis } from "@/lib/agents/trading-agent/skills/currency-expert-analysis";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get("pair");
    if (!pair) {
      return NextResponse.json({ error: "Query param 'pair' is required, e.g. ?pair=EUR/USD." }, { status: 400 });
    }
    const result = await getCurrencyExpertAnalysis(pair);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
