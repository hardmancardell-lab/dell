import { NextResponse } from "next/server";
import { fetchFinancialBundle } from "@/lib/data/sec-financials";
import { fetchDailyBars, fetchQuote } from "@/lib/data/market-data";
import { fetchFredSeries, latest } from "@/lib/data/fred";
import { analyzeLifecycle, DEFAULT_PHASE_RULE, DEFAULT_THRESHOLDS } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import type { Phase, PhaseRule } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import { DEFAULT_VALUATION_SETTINGS, valuationForPhase } from "@/lib/agents/research-agent/skills/phase-valuation";
import { multipleHistory, summarize } from "@/lib/agents/research-agent/skills/multiple-history";
import type { HistorySummary, MultipleKey, PricePoint } from "@/lib/agents/research-agent/skills/multiple-history";
import { buildCrossChecks, DEFAULT_RATING_BANDS, rateValuation } from "@/lib/agents/research-agent/skills/valuation-rating";
import type { EnteredAverages } from "@/lib/agents/research-agent/skills/valuation-rating";

export const maxDuration = 30;

/**
 * Business phase, valuation and a five-level rating for one company, from its
 * own SEC filings.
 *
 *   GET /api/company-lifecycle?ticker=NVDA
 *     &price=239.10                       optional: use this price instead of the market-data provider
 *     &phase=4                            optional: value it as this phase instead of the computed one
 *     &rule=capital-return-first|growth-first   optional: how the phase is decided (default capital-return-first)
 *     &rate=10 &terminal=3 &years=10 &basis=fcf|fcfAfterStockPay      optional valuation assumptions
 *     &avgPE=48.7 &avgPS= &avgPGP= &avgPFCF=                          optional one-year average multiples you enter
 *
 * Nothing here is a recommendation. The response carries the assumptions used.
 */

function numParam(sp: URLSearchParams, key: string, min: number, max: number): number | null | "bad" {
  const raw = sp.get(key);
  if (raw === null || raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : "bad";
}

/** Last close of each of the most recent `months` completed calendar months, from daily bars. */
function monthEndCloses(bars: { datetime: number; close: number }[], months: number, now = new Date()): PricePoint[] {
  const byMonth = new Map<string, { datetime: number; close: number }>();
  for (const b of bars) {
    const d = new Date(b.datetime);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const cur = byMonth.get(key);
    if (!cur || b.datetime > cur.datetime) byMonth.set(key, b);
  }
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return [...byMonth.entries()]
    .filter(([k]) => k < thisMonth)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-months)
    .map(([, b]) => ({ date: new Date(b.datetime).toISOString().slice(0, 10), price: b.close }));
}

/** Provider errors can carry whole HTML pages; show a short plain-text version. */
function plainError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : fallback;
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 160);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const ticker = (sp.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Provide a valid 'ticker' query param, for example ?ticker=NVDA." }, { status: 400 });
  }

  const priceIn = numParam(sp, "price", 0.01, 1_000_000);
  const phaseIn = numParam(sp, "phase", 1, 5);
  const rate = numParam(sp, "rate", 3, 25);
  const terminal = numParam(sp, "terminal", 0, 6);
  const years = numParam(sp, "years", 5, 20);
  const avgPE = numParam(sp, "avgPE", 0.1, 5000);
  const avgPS = numParam(sp, "avgPS", 0.01, 5000);
  const avgPGP = numParam(sp, "avgPGP", 0.01, 5000);
  const avgPFCF = numParam(sp, "avgPFCF", 0.1, 5000);
  if ([priceIn, phaseIn, rate, terminal, years, avgPE, avgPS, avgPGP, avgPFCF].includes("bad")) {
    return NextResponse.json({ error: "A numeric parameter was out of range (price > 0, phase 1 to 5, rate 3 to 25, terminal 0 to 6, years 5 to 20, averages > 0)." }, { status: 400 });
  }
  const basis = sp.get("basis") === "fcfAfterStockPay" ? "fcfAfterStockPay" : "fcf";
  const discountRatePct = (rate as number | null) ?? DEFAULT_VALUATION_SETTINGS.discountRatePct;
  const terminalGrowthPct = (terminal as number | null) ?? DEFAULT_VALUATION_SETTINGS.terminalGrowthPct;
  if (discountRatePct <= terminalGrowthPct) {
    return NextResponse.json({ error: "The discount rate must be higher than terminal growth." }, { status: 400 });
  }
  const entered: EnteredAverages = {
    priceToEarnings: avgPE as number | null,
    priceToSales: avgPS as number | null,
    priceToGrossProfit: avgPGP as number | null,
    priceToFcf: avgPFCF as number | null,
  };

  try {
    const { history, snapshots, shares } = await fetchFinancialBundle(ticker);
    const rule: PhaseRule = sp.get("rule") === "growth-first" ? "growth-first" : DEFAULT_PHASE_RULE;
    const analysis = analyzeLifecycle(history, DEFAULT_THRESHOLDS, undefined, rule);

    // Price: the caller's value, else the app's market-data provider, else none (the phase analysis still works).
    let price: number | null = priceIn as number | null;
    let priceSource: "provided" | "market-data" | "unavailable" = price !== null ? "provided" : "unavailable";
    let priceNote: string | null = null;
    if (price === null) {
      try {
        const q = await fetchQuote(ticker);
        if (Number.isFinite(q.lastPrice) && q.lastPrice > 0) {
          price = q.lastPrice;
          priceSource = "market-data";
        }
      } catch (e) {
        priceNote = `No live price: ${plainError(e, "the market-data provider failed")}. Add &price= to value it at a price you enter.`;
      }
    }

    let riskFreePct: number | null = null;
    try {
      const obs = latest(await fetchFredSeries("DGS10", 10));
      riskFreePct = obs ? obs.value : null;
    } catch {
      riskFreePct = null;
    }

    const usedPhase = (phaseIn as number | null) ?? analysis.phase.phase;
    let valuation = null;
    let rating = null;
    let valuationNote: string | null = null;
    let historySource: "market-data" | "entered" | "none" = "none";
    let historyNote: string | null = null;

    if (!history.ttm || !history.sharesOutstanding) {
      valuationNote = "Not enough filing data (trailing twelve months or share count) to value the company.";
    } else if (price === null) {
      valuationNote = priceNote ?? "No price available, so only the business phase is shown.";
    } else if (usedPhase === null) {
      valuationNote = "The phase could not be determined, so no valuation lens was chosen.";
    } else {
      valuation = valuationForPhase(usedPhase as Phase, {
        price,
        sharesOutstanding: history.sharesOutstanding.value,
        netCash: history.balance?.netCash ?? null,
        ttm: history.ttm,
        ttmYearAgo: history.ttmYearAgo,
        riskFreePct,
        discountRatePct,
        terminalGrowthPct,
        years: (years as number | null) ?? DEFAULT_VALUATION_SETTINGS.years,
        cashFlowBasis: basis,
      });

      // The company's own past year of multiples, from real price history when the provider has it.
      let summaries: HistorySummary[] = [];
      try {
        const end = Date.now();
        const bars = await fetchDailyBars(ticker, end - 400 * 86_400_000, end, 60 * 60 * 6);
        const points = monthEndCloses(bars, 12);
        if (points.length >= 6) {
          const hist = multipleHistory(snapshots, shares, points);
          const m = valuation.multiples;
          const current: Record<MultipleKey, number | null> = { priceToSales: m.priceToSales, priceToGrossProfit: m.priceToGrossProfit, priceToEarnings: m.priceToEarnings, priceToFcf: m.priceToFcf };
          summaries = (Object.keys(current) as MultipleKey[]).map((k) => summarize(hist, k, current[k]));
          historySource = "market-data";
        }
      } catch (e) {
        historyNote = `No price history from the market-data provider (${plainError(e, "request failed")}).`;
      }
      const anyEntered = Object.values(entered).some((v) => v !== null && v !== undefined);
      if (historySource === "none" && anyEntered) historySource = "entered";

      rating = rateValuation(valuation, summaries, entered, DEFAULT_RATING_BANDS, "the past 12 months");
      rating.crossChecks = buildCrossChecks(valuation, rating, history.annual, history.ttm);
      if (historySource === "none" && !historyNote) historyNote = "No price history was available. Enter a one-year average multiple to get a rating.";
    }

    return NextResponse.json({
      ticker,
      analysis,
      valuation,
      rating,
      valuationNote,
      historySource,
      historyNote,
      ratingBands: DEFAULT_RATING_BANDS,
      computedPhase: analysis.phase.phase,
      valuedAsPhase: usedPhase,
      overridden: phaseIn !== null && phaseIn !== analysis.phase.phase,
      price: { value: price, source: priceSource },
      riskFreePct,
      balance: history.balance,
      sharesOutstanding: history.sharesOutstanding,
      thresholds: DEFAULT_THRESHOLDS,
      sources: { financials: "SEC EDGAR XBRL company facts (10-K and 10-Q filings)", price: priceSource, history: historySource, riskFree: riskFreePct !== null ? "FRED DGS10" : null },
      disclaimer: "Educational screen output from the company's filings and a stated price. Not a recommendation to buy or sell, and not a forecast.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
