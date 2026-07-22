import { NextResponse } from "next/server";
import { computeGexSignal } from "@/lib/agents/trading-agent/skills/gex-signal";
import { logSignal } from "@/lib/agents/trading-agent/skills/paper-backtest-log";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  try {
    const signal = await computeGexSignal(ticker);
    // Best-effort logging side effect — a write failure here shouldn't fail
    // the request, since the live signal itself already computed fine.
    await logSignal(signal).catch(() => {});
    return NextResponse.json(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
