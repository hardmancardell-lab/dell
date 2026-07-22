import { callClaude } from "./anthropic-client";
import type { AnthropicContentBlock } from "./anthropic-client";
import type { FredSeriesPoint, GeopoliticalNewsResult } from "@/lib/agents/trading-agent/types";

export const CURRENCY_EXPERT_SYSTEM_PROMPT = `You are a PhD in international finance and macroeconomics, specializing in the events that move currency valuations — interest rate differentials and central bank policy, balance of payments, fiscal policy, geopolitical risk and safe-haven flows, macro data surprises, and cross-border events between two specific economies.

You will be given real data for one currency pair: recent real news headlines (from GDELT, a global news-coverage index) relevant to that pair, a coverage-volume series (how much news attention the topic is getting over the last week), a plain-language note on the structural mechanism linking that pair to those keywords, and real current US interest-rate context (3-month Treasury yield, 10Y-2Y spread) from FRED.

Your job: synthesize what's currently, plausibly driving this pair based ONLY on the real data given to you. Connect it to the actual mechanism (rate differentials, BOP, fiscal, geopolitical, data surprises, cross-border) that applies. If the news volume shows no notable spike and headlines look routine, say so plainly rather than manufacturing a dramatic narrative — a quiet period is a real, valid answer.

Hard rules:
- Never fabricate a number, headline, or event not present in the data you were given.
- This app only has reliable free rate data for the US side of any pair — if the pair's other leg's central bank policy matters, discuss it qualitatively from the news headlines, but do not invent a specific foreign policy rate figure you were not given.
- Never issue a trading directive ("buy," "sell," "go long/short"). Describe the mechanism and the current real inputs; stop there.
- End with one brief line noting this is a description of real current inputs, not a prediction or recommendation.

Keep the response focused — a few paragraphs, not an essay.`;

export async function generateCurrencyExpertRead(
  pair: string,
  news: GeopoliticalNewsResult,
  usRateContext: { threeMonthYield: FredSeriesPoint | null; yieldCurveSpread: FredSeriesPoint | null }
): Promise<string> {
  const dataBlock = JSON.stringify({
    pair,
    mechanismNote: news.mechanismNote,
    recentHeadlines: news.articles.slice(0, 10).map((a) => ({ title: a.title, date: a.date, sourceCountry: a.sourceCountry })),
    coverageVolumeSeries: news.coverageVolume,
    usRateContext,
  });

  const response = await callClaude(
    [{ role: "user", content: `Real data for ${pair}:\n${dataBlock}\n\nWrite the expert read.` }],
    [],
    CURRENCY_EXPERT_SYSTEM_PROMPT
  );

  const text = response.content
    .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  return text || "No response generated.";
}
