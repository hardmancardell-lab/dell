import { NextResponse } from "next/server";
import { MAX_STUDY_DAYS, runVwapBandStudy } from "@/lib/agents/trading-agent/skills/vwap-band-study";

export const maxDuration = 60;

// Equity tickers (AAPL, BRK.B) or forex pairs in the EUR/USD form.
const SYMBOL = /^([A-Za-z][A-Za-z0-9.-]{0,9}|[A-Za-z]{3}\/[A-Za-z]{3})$/;

/**
 * Intraday VWAP band study for one symbol: what happened after price touched session VWAP +/- k sigma, split by
 * the volume Z-score at the touch. Read-only research, no orders, behind the same login as the other studies.
 *
 *   GET /api/vwap-band-study?ticker=SPY&days=90&k=2&logVolume=false&gamma=true
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const ticker = (sp.get("ticker") ?? "").trim();
  if (!SYMBOL.test(ticker)) {
    return NextResponse.json({ error: "Provide a ticker such as SPY, or a forex pair such as GBP/JPY." }, { status: 400 });
  }

  const days = sp.get("days") ? Number(sp.get("days")) : 90;
  if (!Number.isFinite(days) || days < 30 || days > MAX_STUDY_DAYS) {
    return NextResponse.json({ error: `'days' must be a number between 30 and ${MAX_STUDY_DAYS}.` }, { status: 400 });
  }
  const k = sp.get("k") ? Number(sp.get("k")) : 2;
  if (!Number.isFinite(k) || k < 1 || k > 3) {
    return NextResponse.json({ error: "'k' (band width in standard deviations) must be between 1 and 3." }, { status: 400 });
  }
  const logVolume = sp.get("logVolume") === "true";
  const gamma = sp.get("gamma") !== "false";

  try {
    const result = await runVwapBandStudy(ticker, days, { k, useLogVolume: logVolume }, gamma);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
