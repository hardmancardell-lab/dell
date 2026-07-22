import { NextResponse } from "next/server";
import { getSectorStockAnalysis } from "@/lib/agents/research-agent/skills/sector-stock-analysis";
import { getMacroOverview } from "@/lib/agents/research-agent/skills/macro-overview";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sector = searchParams.get("sector");
    if (!sector) {
      return NextResponse.json({ error: "Query param 'sector' is required." }, { status: 400 });
    }
    const forecast = searchParams.get("forecast") === "true";
    const matrix = await getMacroOverview();
    const result = await getSectorStockAnalysis(sector, matrix, forecast);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
