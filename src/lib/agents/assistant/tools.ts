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
import { upcomingCatalysts, type CatalystImpact } from "../trading-agent/skills/catalyst-calendar";
import { getCryptoRegime } from "../trading-agent/skills/crypto-regime-service";
import { classifyPutCallSkew, computeChainWideUnusualActivity } from "../trading-agent/skills/options-flow-skew";
import { findCorrelations, DEFAULT_CORRELATION_CANDIDATES } from "../trading-agent/skills/correlation-finder";
import { getRollingMoveStats } from "../trading-agent/skills/rolling-move-stats";
import { getRecentHypotheses, isHypothesisLedgerConfigured } from "@/lib/data/hypothesis-ledger-db";
import { fetchQuote } from "@/lib/data/market-data";
import { submitFeedback, type FeedbackCategory } from "@/lib/analytics/feedback";
import type { LlmToolSchema } from "./llm-client";
import { validateToolInput } from "./tool-validation";
import { CONFIRMABLE_TOOLS, describePending, type ConfirmableTool } from "./confirmations";
import { SlidingWindowLimiter } from "@/lib/access/rate-limit";
import { isValidSessionId } from "@/lib/data/postgrest-safe";
import type { AssetClass } from "../trading-agent/types";

// Defensive cap on any single tool result serialized back to the model —
// none of the underlying skills should ever get near this, but it's a
// backstop against an unexpectedly large payload blowing the context.
const MAX_RESULT_CHARS = 15000;

export const ASSISTANT_TOOLS: LlmToolSchema[] = [
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
      "The full 7-criteria value checklist plus NCAV valuation, liquidity, solvency, dividend record, and multi-year financial statements for one ticker. The core bottom-of-the-stack company fundamentals tool.",
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
      "Real dealer options-positioning read for one underlying: gamma exposure regime, gamma flip level (spot sweep), term structure, and flow at the call wall (most call gamma above spot) and put wall (most put gamma below spot), combined over the next 45 days of expirations. The regime label rests on an assumed dealer sign (short calls, long puts, so call-heavy gamma reads negative); the result includes netToGrossPct, a balanced flag when call and put gamma are within 10% (then the label is a coin flip: say balanced) and the label under the opposite assumption. The walls and flip level do not depend on the sign. Useful context on likely near-term volatility behavior, not a price forecast.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_crypto_regime",
    description:
      "Six-condition crypto breakout checklist from free public data (stablecoin supply growth, US spot BTC ETF flows month to date, BTC dominance, BTC vs its 200-day average, the 10-year yield, Fear & Greed), scored 0 to 6: 4 or more is a breakout regime, 3 mixed, 2 or fewer range-bound. Use it for crypto questions about the market regime. A condition whose data could not be read is 'unavailable' and never counts as met; if the label is 'undetermined' say so rather than picking one. ETF flows have no free feed: pass etfFlowsMtdMusd only if the user gives the figure. It describes market conditions; it is not advice and not a price forecast.",
    input_schema: {
      type: "object",
      properties: { etfFlowsMtdMusd: { type: "number", description: "Optional: US spot BTC ETF net flows month to date, in $M, as given by the user." } },
    },
  },
  {
    name: "get_catalyst_calendar",
    description:
      "Dated events that can move markets, from a checked-in calendar whose official dates were read from the publishers (Fed, ECB, Bank of England, Bank of Japan, BLS CPI/PPI/jobs, NYSE) plus rule-based dates (option expirations, US election day, month-end). Each event has an impact tag, a region and a source. Pass a ticker, forex pair (GBP/JPY) or crypto symbol to see only what matters for it. Use it for 'what is coming up', 'when is the next Fed/CPI/jobs report', or to flag an event inside a trade's time horizon. It gives dates only, never a direction; say when the calendar's notes mention a coverage gap.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days ahead, 1 to 366. Default 30." },
        symbol: { type: "string", description: "Optional ticker, forex pair like 'GBP/JPY', or crypto symbol like 'BTC-USD'." },
        minImpact: { type: "string", enum: ["low", "medium", "high"], description: "Lowest impact to include. Default low (everything)." },
      },
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
  {
    name: "get_rolling_move_stats",
    description:
      "Real rolling 20/40/100-day average up-day return, average down-day return, and average absolute move, computed directly from actual daily bars — not a textbook/memorized approximation. Use this instead of stating a remembered 'typical daily move' figure for any ticker or FX pair.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        assetClass: { type: "string", enum: ["equity", "forex", "commodity", "future", "bond", "option", "crypto"], description: "Defaults to 'equity' if omitted. Use 'crypto' with a Coinbase USD product id such as BTC-USD." },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_strategy_hypotheses",
    description:
      "Real, already-backtested strategy results from this app's own weekly automated sweep — each one validated (passed real BH-FDR significance + bootstrap CI + out-of-sample sign check) or rejected (with the real reason), across a fixed ticker universe. Call this before answering any 'any good strategies right now' or 'what's working' question — never invent a strategy or its stats from scratch.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_paper_trading_ticket",
    description:
      "Proposes a real 'Open Paper Trading' button in the chat (it appears only after the user confirms) — it does NOT place any order itself. Use this when the conversation naturally arrives at a specific, concrete paper-trading action the user could take (e.g. after discussing a ticker's setup or a specific option contract) and you want to offer a one-click way to go set it up. Never call this to execute a trade — navigation only, the user still has to fill in and submit the ticket themselves.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Underlying ticker or forex pair, e.g. 'AAPL' or 'EUR/USD'." },
        assetClass: { type: "string", enum: ["equity", "forex", "commodity", "future", "option", "crypto"] },
        optionRight: { type: "string", enum: ["call", "put"], description: "Only for assetClass 'option'." },
        strikePrice: { type: "number", description: "Only for assetClass 'option'." },
        expirationDate: { type: "string", description: "YYYY-MM-DD. Only for assetClass 'option'." },
      },
      required: ["symbol", "assetClass"],
    },
  },
  {
    name: "submit_feedback",
    description:
      "Logs a suggestion, bug report, or other feedback the user is giving about this app so the team can review it later. Call this whenever the user offers a feature idea, reports something broken or confusing, or explicitly says they want to leave feedback — don't just acknowledge it in text, actually call this tool. The feedback is stored only after the user confirms the draft, so after calling it tell them what will be sent and ask them to confirm. Use the user's own words for the message, not a paraphrase that loses specifics.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["suggestion", "problem", "other"] },
        message: { type: "string", description: "The feedback itself, in the user's own words." },
      },
      required: ["category", "message"],
    },
  },
];

const MAX_ROWS = 25;

/**
 * Keep a tool result inside the context budget WITHOUT silently losing the fact that it was cut: oversized arrays are
 * trimmed by row, any other oversized payload is cut at the character cap, and both carry a dataLimitations note that
 * the route copies into the response shown to the user.
 */
function truncate(payload: unknown): unknown {
  if (Array.isArray(payload) && payload.length > MAX_ROWS) {
    const trimmed = { rows: payload.slice(0, MAX_ROWS), totalRows: payload.length, dataLimitations: [`Showing the first ${MAX_ROWS} of ${payload.length} rows.`] };
    return truncate(trimmed);
  }
  const json = JSON.stringify(payload);
  if (json === undefined || json.length <= MAX_RESULT_CHARS) return payload;
  return {
    truncated: true,
    dataLimitations: [`A tool result was longer than ${MAX_RESULT_CHARS} characters and was cut off; the answer may be missing detail.`],
    preview: json.slice(0, MAX_RESULT_CHARS),
  };
}

export interface ToolOutcome {
  result: unknown;
  /** True when the call failed validation or threw; the route sets is_error on the tool_result. */
  isError: boolean;
  /** Set for submit_feedback / open_paper_trading_ticket before the user has confirmed: nothing has happened yet. */
  pending?: { tool: ConfirmableTool; input: Record<string, unknown>; summary: string };
}

// Best-effort, per-instance: at most 5 confirmed feedback submissions per hour per session id.
const feedbackLimiter = new SlidingWindowLimiter(5, 60 * 60_000);

const TOOL_SCHEMAS = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

/**
 * Validates the model's input against the tool schema, then runs the tool. Confirmable tools do NOT run on the
 * model's say-so: without `confirmed` they return a pending proposal (see confirmations.ts).
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  sessionId?: string,
  opts: { confirmed?: boolean } = {}
): Promise<ToolOutcome> {
  const schema = TOOL_SCHEMAS.get(name);
  if (!schema) return { result: { error: `Unknown tool: ${String(name).slice(0, 60)}` }, isError: true };

  const checked = validateToolInput(schema, name, rawInput);
  if (!checked.ok) return { result: { error: `Invalid input for ${name}: ${checked.error}` }, isError: true };
  const input = checked.input;

  if ((CONFIRMABLE_TOOLS as readonly string[]).includes(name) && !opts.confirmed) {
    const tool = name as ConfirmableTool;
    return {
      result: {
        status: "awaiting_user_confirmation",
        note: "Nothing has been submitted or opened yet. Tell the user exactly what will happen and ask them to confirm (they can click Confirm or reply yes). Do not call this tool again.",
      },
      isError: false,
      pending: { tool, input, summary: describePending(tool, input) },
    };
  }

  try {
    switch (name) {
      case "get_macro_overview":
        return ok(truncate(await getMacroOverview()));
      case "get_sector_recommendations":
        return ok(truncate(await getSectorRecommendations(await getMacroOverview())));
      case "get_sector_fundamentals":
        return ok(truncate(await getSectorFundamentals(String(input.sector))));
      case "get_security_analysis":
        return ok(truncate(await getSecurityAnalysis(String(input.ticker))));
      case "get_sector_peer_ranking":
        return ok(truncate(await getSectorPeerRanking(String(input.ticker))));
      case "get_quote":
        return ok(truncate(await fetchQuote(String(input.ticker))));
      case "get_gex_signal":
        return ok(truncate(await computeGexSignal(String(input.ticker))));
      case "get_crypto_regime": {
        const etf = typeof input.etfFlowsMtdMusd === "number" ? input.etfFlowsMtdMusd : undefined;
        return ok(truncate(await getCryptoRegime({ etfFlowsMtdMusd: etf })));
      }
      case "get_catalyst_calendar": {
        const days = typeof input.days === "number" ? input.days : 30;
        const impact = (typeof input.minImpact === "string" ? input.minImpact : "low") as CatalystImpact;
        const symbol = typeof input.symbol === "string" ? input.symbol : undefined;
        return ok(truncate(upcomingCatalysts({ days, symbol, minImpact: impact })));
      }
      case "get_options_chain_summary": {
        const chain = await getOptionsChainSummary(String(input.ticker));
        return ok(
          truncate({
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
          })
        );
      }
      case "get_correlations": {
        const candidates = Array.isArray(input.candidates) && input.candidates.length > 0 ? (input.candidates as string[]) : DEFAULT_CORRELATION_CANDIDATES;
        return ok(truncate(await findCorrelations(String(input.baseSymbol), candidates)));
      }
      case "get_rolling_move_stats": {
        const assetClass = (typeof input.assetClass === "string" ? input.assetClass : "equity") as AssetClass;
        return ok(truncate(await getRollingMoveStats(String(input.ticker), assetClass)));
      }
      case "get_strategy_hypotheses": {
        if (!isHypothesisLedgerConfigured()) {
          return { result: { error: "Strategy hypothesis ledger is not configured yet." }, isError: true };
        }
        return ok(truncate(await getRecentHypotheses(50)));
      }
      case "open_paper_trading_ticket": {
        return ok({
          action: "open_paper_trading_ticket",
          target: { primaryId: "trading", secondaryId: "paper-trading" },
          prefill: {
            symbol: String(input.symbol),
            assetClass: String(input.assetClass),
            optionRight: typeof input.optionRight === "string" ? input.optionRight : null,
            strikePrice: typeof input.strikePrice === "number" ? input.strikePrice : null,
            expirationDate: typeof input.expirationDate === "string" ? input.expirationDate : null,
          },
        });
      }
      case "submit_feedback": {
        const sid = isValidSessionId(sessionId) ? sessionId : "unknown";
        const limited = feedbackLimiter.hit(sid);
        if (!limited.allowed) return { result: { error: "Too many feedback submissions from this session; try again later." }, isError: true };
        const result = await submitFeedback({ sessionId: sid, category: input.category as FeedbackCategory, message: String(input.message), source: "assistant_chat" });
        return ok(result);
      }
      default:
        return { result: { error: `Unknown tool: ${name}` }, isError: true };
    }
  } catch (error) {
    // Upstream error text can contain URLs, table names or key hints; keep it in the server log, give the model a stable message.
    console.error(`assistant tool ${name} failed:`, error instanceof Error ? error.message.slice(0, 300) : "unknown error");
    return { result: { error: `The ${name} tool is unavailable right now (data source error).`, code: "tool_failed" }, isError: true };
  }
}

function ok(result: unknown): ToolOutcome {
  return { result, isError: false };
}

/** Legacy entry point (kept for existing callers and tests): runs a tool as if the user had already confirmed nothing. */
export async function dispatchTool(name: string, input: Record<string, unknown>, sessionId?: string): Promise<unknown> {
  return (await runTool(name, input, sessionId)).result;
}
