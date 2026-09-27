import { NextResponse } from "next/server";
import { computeYieldThresholdEtfPrice } from "@/lib/agents/trading-agent/skills/yield-etf-price-threshold";

export const maxDuration = 30;

const FRED_SERIES_LABELS: Record<string, string> = {
  DGS10: "10-Year Treasury Yield",
  DGS2: "2-Year Treasury Yield",
  DGS30: "30-Year Treasury Yield",
  DGS5: "5-Year Treasury Yield",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fredSeriesId = (searchParams.get("fredSeriesId") ?? "DGS10").toUpperCase();
  const etfTicker = searchParams.get("etfTicker") ?? "IEF";
  const targetYieldPct = Number(searchParams.get("targetYieldPct") ?? "5.25");
  const lookbackYears = Number(searchParams.get("lookbackYears") ?? "2");
  const fredSeriesLabel = FRED_SERIES_LABELS[fredSeriesId] ?? fredSeriesId;

  try {
    const result = await computeYieldThresholdEtfPrice(fredSeriesId, fredSeriesLabel, etfTicker, targetYieldPct, lookbackYears);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
