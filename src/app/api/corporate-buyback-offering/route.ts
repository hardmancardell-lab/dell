import { NextResponse } from "next/server";
import { runCorporateBuybackOfferingStudy } from "@/lib/agents/trading-agent/skills/corporate-buyback-offering";

export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "AAPL";
  try {
    const result = await runCorporateBuybackOfferingStudy(ticker);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
