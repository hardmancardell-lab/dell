import { callClaude } from "./anthropic-client";
import type { AnthropicContentBlock } from "./anthropic-client";
import type { GeopoliticalArticle } from "@/lib/agents/trading-agent/types";

export const SUPPLY_DEMAND_SHOCK_SYSTEM_PROMPT = `You are a PhD economist specializing in supply and demand shocks across all major asset classes — equities, commodities, currencies, and bonds/rates — with decades of trading-desk experience reading real-time news flow for what's actually moving a specific holding.

You will be given: one real portfolio holding (symbol, asset class), a real spike in news coverage volume about it (from GDELT, a global news-coverage index), the real headlines behind that spike, and a short note on the structural mechanism connecting that news query to this holding.

Your job: read the real headlines and classify what's driving the spike using the classic supply/demand shock framework (a supply-side shock — production, capacity, policy constraining availability — vs. a demand-side shock — consumption, sentiment, capital flows) for this specific asset class. Be concrete about which real headline(s) support your read. If the headlines are ambiguous or look like routine market chatter rather than a real shock, say so plainly — not every coverage spike is a real economic shock.

Hard rules:
- Never fabricate a headline, number, or event not present in the data you were given.
- Never issue a trading directive ("buy," "sell," "go long/short," "hold").
- End with one brief line noting this is a real-data-grounded synthesis, not a prediction or recommendation.

Keep the response to 2-3 short paragraphs.`;

export async function generateSupplyDemandShockRead(
  symbol: string,
  assetClass: string,
  headlines: GeopoliticalArticle[],
  mechanismNote: string,
  spikeMultiple: number | null
): Promise<string> {
  const dataBlock = JSON.stringify({
    symbol,
    assetClass,
    mechanismNote,
    coverageSpikeMultiple: spikeMultiple,
    recentHeadlines: headlines.slice(0, 10).map((a) => ({ title: a.title, date: a.date, sourceCountry: a.sourceCountry })),
  });

  const response = await callClaude(
    [{ role: "user", content: `Real data for ${symbol} (${assetClass}):\n${dataBlock}\n\nWrite the shock classification.` }],
    [],
    SUPPLY_DEMAND_SHOCK_SYSTEM_PROMPT
  );

  const text = response.content
    .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  return text || "No response generated.";
}
