import { NextResponse } from "next/server";
import { fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";
import { getCurrentRiskFreeRate } from "@/lib/agents/trading-agent/skills/options-calculator";
import { computeOptionScenarioAnalysis } from "@/lib/agents/trading-agent/skills/option-scenario";
import type { PaperOptionRight } from "@/lib/agents/trading-agent/types";

export const maxDuration = 30;

/** Skips weekends only (a disclosed simplification — real market holidays aren't accounted for), same convention used elsewhere in this app for calendar-day-to-trading-day approximations. */
function addTradingDays(fromDateKey: string, tradingDays: number): string {
  const d = new Date(`${fromDateKey}T00:00:00`);
  let remaining = tradingDays;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const expirationDate = searchParams.get("expiration");
  const optionRight = searchParams.get("right") as PaperOptionRight | null;
  const longStrike = Number(searchParams.get("longStrike"));
  const shortStrikeParam = searchParams.get("shortStrike");
  const shortStrike = shortStrikeParam ? Number(shortStrikeParam) : null;
  const horizonDays = Number(searchParams.get("horizonDays") ?? "20");

  if (!ticker || !expirationDate || (optionRight !== "call" && optionRight !== "put") || !Number.isFinite(longStrike)) {
    return NextResponse.json({ error: "Missing/invalid required params: ticker, expiration, right (call|put), longStrike." }, { status: 400 });
  }

  try {
    const symbol = ticker.trim().toUpperCase();
    const [quote, chain, riskFreeRate] = await Promise.all([
      fetchQuote(symbol),
      fetchOptionsChain(symbol, expirationDate),
      getCurrentRiskFreeRate(),
    ]);

    const sideContracts = optionRight === "call" ? chain.calls : chain.puts;
    const longContract = sideContracts.find((c) => c.strikePrice === longStrike);
    if (!longContract) {
      return NextResponse.json({ error: `No live contract found for ${symbol} ${expirationDate} $${longStrike} ${optionRight}.` }, { status: 404 });
    }
    const shortContract = shortStrike !== null ? sideContracts.find((c) => c.strikePrice === shortStrike) : null;
    if (shortStrike !== null && !shortContract) {
      return NextResponse.json({ error: `No live contract found for the short leg ${symbol} ${expirationDate} $${shortStrike} ${optionRight}.` }, { status: 404 });
    }

    const entryDebit = shortContract ? longContract.ask - shortContract.bid : longContract.ask;
    const todayDateKey = new Date().toISOString().slice(0, 10);
    const scenarioDate = addTradingDays(todayDateKey, horizonDays);

    const analysis = computeOptionScenarioAnalysis({
      optionRight,
      longStrike,
      shortStrike,
      spotPrice: quote.lastPrice,
      entryDebit,
      scenarioDate,
      expirationDate,
      impliedVolatilityPct: longContract.volatility,
      riskFreeRatePct: riskFreeRate.ratePercent,
    });

    return NextResponse.json({ ...analysis, entryDebit, spotPrice: quote.lastPrice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
