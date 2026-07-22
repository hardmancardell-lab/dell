import { fetchFredSeries, latest } from "@/lib/data/fred";
import { getGeopoliticalNews, MAJOR_PAIR_KEYWORDS } from "./geopolitical-news";
import { isAnthropicConfigured } from "@/lib/agents/assistant/anthropic-client";
import { generateCurrencyExpertRead } from "@/lib/agents/assistant/currency-analysis-prompt";
import type { CurrencyExpertAnalysisResult, FredSeriesPoint } from "../types";

// Best-effort keyword coverage for currencies in top-traded-pairs.ts that
// aren't one of the 6 seeded MAJOR_PAIR_KEYWORDS pairs (NZD, CNH) — combined
// with the seeded map for cross pairs (e.g. EUR/GBP combines both legs'
// queries). Not as tailored as the hand-written mechanismNote entries, but a
// real, honest query rather than skipping non-major pairs entirely.
const CURRENCY_CODE_QUERY: Record<string, string> = {
  EUR: `"European Central Bank" OR Eurozone OR ECB`,
  USD: `"Federal Reserve" OR Fed OR "US economy"`,
  JPY: `"Bank of Japan" OR BOJ OR yen`,
  GBP: `"Bank of England" OR "British pound"`,
  CHF: `"Swiss National Bank" OR SNB OR "Swiss franc"`,
  AUD: `"Reserve Bank of Australia" OR RBA`,
  CAD: `"Bank of Canada" OR "Canada economy"`,
  NZD: `"Reserve Bank of New Zealand" OR RBNZ OR "New Zealand dollar"`,
  CNH: `China OR yuan OR PBOC OR renminbi`,
  CNY: `China OR yuan OR PBOC OR renminbi`,
};

function buildQueryForPair(pair: string): { query: string; mechanismNote: string | null } {
  const seeded = MAJOR_PAIR_KEYWORDS.find((p) => p.pair === pair);
  if (seeded) return { query: seeded.query, mechanismNote: seeded.mechanismNote };

  const [base, quote] = pair.split("/");
  const parts = [CURRENCY_CODE_QUERY[base], CURRENCY_CODE_QUERY[quote]].filter(Boolean) as string[];
  return {
    query: parts.length > 0 ? parts.join(" OR ") : pair,
    mechanismNote:
      parts.length > 0
        ? null
        : "No keyword mapping available for this pair's currencies — searching the raw pair symbol, which may return sparse or irrelevant results.",
  };
}

export async function getCurrencyExpertAnalysis(pair: string): Promise<CurrencyExpertAnalysisResult> {
  const trimmedPair = pair.trim().toUpperCase();
  const { query, mechanismNote } = buildQueryForPair(trimmedPair);

  const [news, dgs3mo, t10y2y] = await Promise.all([
    getGeopoliticalNews(query, trimmedPair, mechanismNote),
    fetchFredSeries("DGS3MO", 5),
    fetchFredSeries("T10Y2Y", 5),
  ]);

  const latestDgs3mo = latest(dgs3mo);
  const latestT10y2y = latest(t10y2y);
  const usRateContext: CurrencyExpertAnalysisResult["usRateContext"] = {
    threeMonthYield: latestDgs3mo
      ? ({ seriesId: "DGS3MO", label: "3-Month Treasury Yield", date: latestDgs3mo.date, value: latestDgs3mo.value } as FredSeriesPoint)
      : null,
    yieldCurveSpread: latestT10y2y
      ? ({ seriesId: "T10Y2Y", label: "10Y-2Y Treasury Spread", date: latestT10y2y.date, value: latestT10y2y.value } as FredSeriesPoint)
      : null,
  };

  const dataLimitations = [...news.dataLimitations];
  dataLimitations.push(
    "US rate context only — this app has no reliable free source for foreign central bank policy rates, so only the US side of any rate-differential story is backed by real numbers here; the foreign side is discussed qualitatively from news headlines only."
  );

  let expertRead: string | null = null;
  if (!isAnthropicConfigured()) {
    dataLimitations.push(
      "Expert narrative synthesis requires a real ANTHROPIC_API_KEY in .env.local — showing the real underlying news and rate data without it."
    );
  } else {
    try {
      expertRead = await generateCurrencyExpertRead(trimmedPair, news, usRateContext);
    } catch (error) {
      dataLimitations.push(`Expert synthesis failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  return { pair: trimmedPair, news, usRateContext, expertRead, dataLimitations };
}
