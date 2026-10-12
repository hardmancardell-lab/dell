import { NextResponse } from "next/server";
import { readSignalLog, runSignalScan } from "@/lib/agents/trading-agent/skills/vwap-signal-service";

export const maxDuration = 60;

// Equity tickers (AAPL, BRK.B) or forex pairs in the EUR/USD form.
const SYMBOL = /^([A-Za-z][A-Za-z0-9.-]{0,9}|[A-Za-z]{3}\/[A-Za-z]{3})$/;

/**
 * Forward-test log for the VWAP-band study. Research and paper only: nothing here places an order. Behind the same
 * login as the other studies (not in the public path list).
 *
 *   GET  /api/vwap-signals?ticker=SPY        saved signals and their summary (ticker optional)
 *   POST /api/vwap-signals {ticker, k}       scan the latest bars now and save new touches
 */
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").trim();
  if (ticker && !SYMBOL.test(ticker)) return NextResponse.json({ error: "Provide a ticker such as SPY, or a forex pair such as GBP/JPY." }, { status: 400 });
  return NextResponse.json(await readSignalLog(ticker || null));
}

export async function POST(request: Request) {
  let body: { ticker?: unknown; k?: unknown; logVolume?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body such as {\"ticker\":\"SPY\"}." }, { status: 400 });
  }
  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!SYMBOL.test(ticker)) return NextResponse.json({ error: "Provide a ticker such as SPY, or a forex pair such as GBP/JPY." }, { status: 400 });
  const k = body.k === undefined ? 2 : Number(body.k);
  if (!Number.isFinite(k) || k < 1 || k > 3) return NextResponse.json({ error: "'k' (band width in standard deviations) must be between 1 and 3." }, { status: 400 });

  try {
    const scan = await runSignalScan(ticker, { k, useLogVolume: body.logVolume === true });
    return NextResponse.json(scan);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
