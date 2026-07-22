import { NextResponse } from "next/server";
import { getPmVolumeAnomalyReport } from "@/lib/agents/trading-agent/skills/pm-volume-tracker";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  try {
    const report = await getPmVolumeAnomalyReport(ticker);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
