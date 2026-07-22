// Read-only wrappers around already-built, already-tested skills across all
// three agents — the assistant never fetches or computes anything new, it
// only orchestrates real data that already exists elsewhere in this app.
// Same per-call try/catch isolation philosophy as watchlist-scan.ts: one
// tool failing returns a plain {error} to the model instead of crashing the
// whole chat turn.

import { getMacroOverview } from "../research-agent/skills/macro-overview";
import { getSectorRecommendations } from "../research-agent/skills/sector-recommendations";
import { getSectorFundamentals } from "../research-agent/skills/sector-fundamentals";
import { getSecurityAnalysis } from "../research-agent/skills/security-analysis";
import { getSectorPeerRanking } from "../research-agent/skills/sector-peer-ranking";
import { getOptionsChainSummary } from "../trading-agent/skills/options-chain";
import { computeGexSignal } from "../trading-agent/skills/gex-signal";
import { classifyPutCallSkew, computeChainWideUnusualActivity } from "../trading-agent/skills/options-flow-skew";
import { findCorrelations, DEFAULT_CORRELATION_CANDIDATES } from "../trading-agent/skills/correlation-finder";
import { fetchQuote } from "@/lib/data/market-data";
import type { AnthropicToolSchema } from "./anthropic-client";

// Defensive cap on any single tool result serialized back to the model —
// none of the underlying skills should ever get near this, but it's a
// backstop against an unexpectedly large payload blowing the context.
const MAX_RESULT_CHARS = 15000;

export const ASSISTANT_TOOLS: AnthropicToolSchema[] = [
  {
    name: "get_macro_overview",
    description:
      "Top of the top-down stack. Real, currently-computed macro read: credit conditions, valuation, production, inflation, and a synthesized overall market stance with rationale. No input needed. Call this first for any 'should I buy/is this a good trade/what's the market environment' question.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_sector_recommendations",
    description:
      "Industry-level read across roughly a dozen sectors — which are constructive, cautious, or mixed right now, and why, based on real computed metrics. No input needed. The layer between macro and an individual company.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_sector_fundamentals",
    description:
      "Real aggregated fundamentals (debt/equity, interest coverage, capex/depreciation, margin stability) across curated bellwether companies in one FMP sector name (e.g. 'Technology', 'Healthcare', 'Energy', 'Financial Services'). Use the fmpSectorName field returned by get_sector_recommendations, not a guessed name.",
    input_schema: {
      type: "object",
      properties: { sector: { type: "string", description: "Exact FMP sector name, e.g. 'Technology'." } },
      required: ["sector"],
    },
  },
  {
    name: "get_security_analysis",
    description:
      "The full Graham 7-criteria checklist plus NCAV valuation, liquidity, solvency, dividend record, and multi-year financial statements for one ticker. The core bottom-of-the-stack company fundamentals tool.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string", description: "Equity ticker symbol, e.g. 'AAPL'." } },
      required: ["ticker"],
    },
  },
  {
    name: "get_sector_peer_ranking",
    description: "Ranks a ticker's real valuation/fundamental ratios against its actual sector peers.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_quote",
    description: "Real current last price and volume for any ticker (equity, forex pair, etc.).",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_gex_signal",
    description:
      "Real dealer options-positioning read for one underlying: gamma exposure regime, gamma flip level, term structure, and flow at the nearest call/put walls. Useful context on likely near-term volatility behavior, not a price forecast.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_options_chain_summary",
    description:
      "Real same-day put/call volume and open-interest totals and ratios for one underlying's options chain, classified into a bullish/bearish/neutral skew label, plus any chain-wide unusual same-day volume/OI activity.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_correlations",
    description:
      "Real computed 1-year daily-return correlations between a base ticker and a set of candidates (defaults to a cross-asset set: gold, Treasuries, utilities, staples, energy, financials, tech, volatility, oil, dollar). Useful for diversification/hedging questions.",
    input_schema: {
      type: "object",
      properties: {
        baseSymbol: { type: "string" },
        candidates: { type: "array", items: { type: "string" }, description: "Optional. Defaults to a standard cross-asset set." },
      },
      required: ["baseSymbol"],
    },
  },
];

function truncate(payload: unknown): unknown {
  const json = JSON.stringify(payload);
  if (json.length <= MAX_RESULT_CHARS) return payload;
  return { truncated: true, preview: json.slice(0, MAX_RESULT_CHARS) };
}

export async function dispatchTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case "get_macro_overview":
        return truncate(await getMacroOverview());
      case "get_sector_recommendations":
        return truncate(await getSectorRecommendations(await getMacroOverview()));
      case "get_sector_fundamentals":
        return truncate(await getSectorFundamentals(String(input.sector ?? "")));
      case "get_security_analysis":
        return truncate(await getSecurityAnalysis(String(input.ticker ?? "")));
      case "get_sector_peer_ranking":
        return truncate(await getSectorPeerRanking(String(input.ticker ?? "")));
      case "get_quote":
        return truncate(await fetchQuote(String(input.ticker ?? "")));
      case "get_gex_signal":
        return truncate(await computeGexSignal(String(input.ticker ?? "")));
      case "get_options_chain_summary": {
        const chain = await getOptionsChainSummary(String(input.ticker ?? ""));
        return truncate({
          ticker: chain.ticker,
          expirationDate: chain.expirationDate,
          totalCallOpenInterest: chain.totalCallOpenInterest,
          totalPutOpenInterest: chain.totalPutOpenInterest,
          totalCallVolume: chain.totalCallVolume,
          totalPutVolume: chain.totalPutVolume,
          putCallVolumeRatio: chain.putCallVolumeRatio,
          putCallOpenInterestRatio: chain.putCallOpenInterestRatio,
          skew: classifyPutCallSkew(chain.putCallVolumeRatio),
          unusualActivity: computeChainWideUnusualActivity(chain),
          dataLimitations: chain.dataLimitations,
        });
      }
      case "get_correlations": {
        const candidates = Array.isArray(input.candidates) && input.candidates.length > 0
          ? (input.candidates as string[])
          : DEFAULT_CORRELATION_CANDIDATES;
        return truncate(await findCorrelations(String(input.baseSymbol ?? ""), candidates));
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error running this tool." };
  }
}
