import { NextResponse } from "next/server";
import { getCryptoRegime } from "@/lib/agents/trading-agent/skills/crypto-regime-service";

// CoinGecko calls are spaced out, so a cold read takes several seconds.
export const maxDuration = 60;

/**
 * The six-condition crypto breakout checklist from keyless public data. Behind the same login as the other studies.
 *
 *   GET /api/crypto-regime
 *   GET /api/crypto-regime?etfFlowsMtdMusd=-386.3     (US spot BTC ETF net flows this month so far, in $M)
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("etfFlowsMtdMusd");
  let etfFlowsMtdMusd: number | undefined;
  if (raw !== null && raw.trim() !== "") {
    etfFlowsMtdMusd = Number(raw);
    if (!Number.isFinite(etfFlowsMtdMusd) || Math.abs(etfFlowsMtdMusd) > 200_000) {
      return NextResponse.json({ error: "'etfFlowsMtdMusd' must be a number of millions of dollars, for example -386.3." }, { status: 400 });
    }
  }
  try {
    return NextResponse.json(await getCryptoRegime({ etfFlowsMtdMusd }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
