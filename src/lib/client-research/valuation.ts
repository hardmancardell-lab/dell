import { fetchQuote } from "@/lib/data/market-data";
import type { MarketQuote } from "@/lib/data/market-data-types";
import { GET as lifecycleGet } from "@/app/api/company-lifecycle/route";
import { PHASE_NAMES, PHASE_PLAIN } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import type { Phase } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import { BusyError, FetchBudget, ResearchCache, Semaphore } from "./cache";
import type { ClientPhaseNumber, HoldingResearch, HoldingValuationView, MeasureRow, OwnAveragePosition } from "./types";

/**
 * One holding's research for the client Research section. It REUSES the advisor tools and adds no maths:
 * the same /api/company-lifecycle handler (filings -> phase -> phase-matched valuation -> rating against the company's own
 * past year) is called in-process. This file only (1) fetches the quote itself so the as-of time, the delayed flag and the
 * synthetic flag are known, (2) caps cost, and (3) turns the result into client-safe wording: no "attractive" or "buy"
 * labels, no sentences addressed to "you", no provider error text.
 */

export const POSITION_FOR_RATING: Record<string, OwnAveragePosition> = {
  "very expensive": "well above",
  expensive: "above",
  "fair value": "near",
  attractive: "below",
  "very attractive": "well below",
};

export interface ValuationDeps {
  quote(symbol: string): Promise<MarketQuote>;
  /** Calls the lifecycle handler with a synthetic request and returns its Response. */
  lifecycle(url: string): Promise<Response>;
  now(): number;
}

export const defaultDeps: ValuationDeps = {
  quote: (s) => fetchQuote(s),
  lifecycle: (url) => lifecycleGet(new Request(url)),
  now: () => Date.now(),
};
let deps: ValuationDeps = defaultDeps;

const MAX_UNCACHED_PER_HOUR = 60;
const budget = new FetchBudget(MAX_UNCACHED_PER_HOUR);
const gate = new Semaphore(2);
let cache = new ResearchCache<HoldingResearch>(30 * 60_000, 24 * 60 * 60_000, budget, gate, () => deps.now());

/** Test seam: swap the upstream calls and start with an empty cache and a fresh budget. */
export function __setValuationDepsForTests(next: Partial<ValuationDeps> | null, opts: { budgetPerHour?: number } = {}): void {
  deps = { ...defaultDeps, ...(next ?? {}) };
  cache = new ResearchCache<HoldingResearch>(30 * 60_000, 24 * 60 * 60_000, new FetchBudget(opts.budgetPerHour ?? MAX_UNCACHED_PER_HOUR), new Semaphore(2), () => deps.now());
}

const MESSAGES = {
  no_filings: "We could not find company filings for this ticker. Funds and some foreign companies have none, so there is nothing to value here.",
  unavailable: "Research for this holding is not available right now. It will be tried again later.",
  busy: "Research is busy right now. Try again in a few minutes.",
} as const;

// The lifecycle handler returns plain JSON whose shape is owned by that route; it is read defensively below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

function plainValuationNote(raw: Raw): string {
  const n = String(raw.valuationNote ?? "");
  if (/Not enough filing data/i.test(n)) return "There is not enough filing data to value this company.";
  if (/phase could not/i.test(n)) return "The business phase could not be set, so no valuation is shown.";
  if (/No price|No live price/i.test(n)) return "No price is available right now, so only the business phase is shown.";
  return "A valuation is not available for this company right now.";
}

/**
 * The tools' own sentences are written for an analyst. Before one reaches a client: price words become neutral
 * ("cheap or dear" -> "high or low"), "this page" becomes "our", and any sentence that speaks to "you" is dropped.
 * Pure and tested; it changes wording only, never a number.
 */
export function clientWords(text: string): string | null {
  if (/\byou(r)?\b/i.test(text)) return null;
  return text
    .replace(/\bcheap or dear\b/gi, "high or low")
    .replace(/\bcheaper\b/gi, "lower priced")
    .replace(/\bcheap\b/gi, "low priced")
    .replace(/\bdearer\b/gi, "higher priced")
    .replace(/\bdear\b/gi, "high priced")
    .replace(/\bthis page's\b/gi, "our")
    .replace(/\bthis page\b/gi, "this tool");
}

/** The cross-check that repeats "what the price assumes" is already shown as its own line, so it is not listed twice. */
const DUPLICATE_CROSS_CHECKS = new Set(["What growth the price assumes"]);

function isoOrNull(ms: unknown): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Pure: turns the lifecycle response (and the quote read beside it) into the client view. Exported for tests. */
export function shapeLifecycle(symbol: string, raw: Raw, quote: MarketQuote | null, fetchedAtMs: number): HoldingResearch {
  const synthetic = quote?.synthetic === true;
  const phaseRes = raw?.analysis?.phase;
  const num = phaseRes?.phase as Phase | null | undefined;
  const phase: HoldingResearch["phase"] =
    num && num >= 1 && num <= 5
      ? {
          number: num as ClientPhaseNumber,
          name: PHASE_NAMES[num],
          plain: PHASE_PLAIN[num],
          confidence: phaseRes.confidence ?? "unknown",
          note: typeof phaseRes.note === "string" && phaseRes.note ? clientWords(phaseRes.note) : null,
          alsoConsistentWith: Array.isArray(phaseRes.alsoConsistentWith)
            ? phaseRes.alsoConsistentWith
                .slice(0, 2)
                .flatMap((a: Raw) => {
                  const t = clientWords(`${PHASE_NAMES[a.phase as Phase] ?? "Another phase"}: ${String(a.reason ?? "")}`.trim());
                  return t === null ? [] : [t];
                })
            : [],
        }
      : null;

  const price = typeof raw?.price?.value === "number" && raw.price.value > 0 && !synthetic
    ? { value: raw.price.value as number, asOf: isoOrNull(quote?.asOf), delayed: typeof quote?.delayed === "boolean" ? quote.delayed : null, feed: quote?.feed ?? null }
    : null;

  let valuation: HoldingValuationView | null = null;
  let valuationNote: string | null = null;
  if (synthetic) {
    valuationNote = "Live prices are not connected here, so no valuation is shown.";
  } else if (raw?.valuation && raw?.rating) {
    const rating = raw.rating;
    const measures: MeasureRow[] = (rating.perMultiple ?? []).map((m: Raw) => ({
      label: String(m.label),
      current: m.current,
      average: m.average,
      premiumPct: m.premiumPct,
      position: POSITION_FOR_RATING[m.rating] ?? "near",
      percentile: typeof m.percentile === "number" ? Math.round(m.percentile) : null,
    }));
    const rd = raw.valuation.reverseDcf;
    valuation = {
      question: String(raw.valuation.question ?? ""),
      position: rating.headline ? (POSITION_FOR_RATING[rating.headline] ?? null) : null,
      averagePremiumPct: typeof rating.averagePremiumPct === "number" ? rating.averagePremiumPct : null,
      window: String(rating.window ?? "the past 12 months"),
      measures,
      priceAssumes:
        rd && typeof rd.impliedGrowthPct === "number"
          ? { growthPctPerYear: rd.impliedGrowthPct, years: raw.valuation.inputs?.years ?? 10, currentCashFlowGrowthPct: typeof rd.currentCashFlowGrowthPct === "number" ? rd.currentCashFlowGrowthPct : null }
          : null,
      otherThings: (rating.crossChecks ?? [])
        .filter((c: Raw) => !DUPLICATE_CROSS_CHECKS.has(String(c.title)))
        .flatMap((c: Raw) => {
          const detail = clientWords(String(c.detail));
          return detail === null ? [] : [{ title: String(c.title), detail }];
        }),
      assumptions: (raw.valuation.caveats ?? []).slice(0, 2).flatMap((c: unknown) => {
        const t = clientWords(String(c));
        return t === null ? [] : [t];
      }),
    };
    if (valuation.position === null) {
      valuationNote = "No price history was available, so there is no comparison with the company's own past year.";
    }
  } else if (raw?.valuationNote) {
    valuationNote = plainValuationNote(raw);
  } else {
    valuationNote = "A valuation is not available for this company right now.";
  }

  const sources = ["SEC EDGAR company filings (10-K and 10-Q)"];
  if (price) sources.push(`Share price from the market-data provider${price.feed ? ` (${price.feed} feed)` : ""}`);
  if (valuation && raw.historySource === "market-data") sources.push("Month-end prices from the market-data provider, for the company's own past-year average");
  if (raw.sources?.riskFree) sources.push("10-year Treasury yield from FRED");

  return {
    symbol,
    status: "ok",
    message: null,
    company: typeof raw?.analysis?.company === "string" ? raw.analysis.company : null,
    phase,
    filingsAsOf: typeof raw?.analysis?.asOf === "string" ? raw.analysis.asOf : null,
    valuation,
    valuationNote,
    price,
    sources,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    stale: false,
    isEstimate: true,
  };
}

function emptyResult(symbol: string, status: "no_filings" | "unavailable" | "busy", fetchedAtMs: number): HoldingResearch {
  return {
    symbol, status, message: MESSAGES[status], company: null, phase: null, filingsAsOf: null, valuation: null, valuationNote: null,
    price: null, sources: [], fetchedAt: new Date(fetchedAtMs).toISOString(), stale: false, isEstimate: true,
  };
}

class TransientError extends Error {}

async function load(symbol: string): Promise<HoldingResearch> {
  let quote: MarketQuote | null = null;
  try {
    quote = await deps.quote(symbol);
  } catch {
    quote = null; // the lifecycle handler still gives the phase; the valuation then says no price is available
  }
  const priceParam = quote && !quote.synthetic && Number.isFinite(quote.lastPrice) && quote.lastPrice > 0 ? `&price=${encodeURIComponent(String(quote.lastPrice))}` : "";
  const url = `http://research.internal/api/company-lifecycle?ticker=${encodeURIComponent(symbol)}${priceParam}`;

  const res = await Promise.race([
    deps.lifecycle(url),
    new Promise<never>((_, reject) => setTimeout(() => reject(new TransientError("timeout")), 40_000).unref?.()),
  ]);
  const body = (await res.json().catch(() => null)) as Raw | null;
  if (!res.ok || !body) {
    const msg = String(body?.error ?? "");
    if (/No SEC listing|No SEC CIK/i.test(msg)) return emptyResult(symbol, "no_filings", deps.now());
    throw new TransientError("upstream");
  }
  return shapeLifecycle(symbol, body, quote, deps.now());
}

/** Never throws. The symbol MUST already have been checked against the client's own holdings by the caller. */
export async function getHoldingResearch(symbol: string): Promise<HoldingResearch> {
  try {
    const c = await cache.get(symbol, () => load(symbol));
    return { ...c.value, stale: c.stale, fetchedAt: new Date(c.fetchedAt).toISOString() };
  } catch (e) {
    return emptyResult(symbol, e instanceof BusyError ? "busy" : "unavailable", deps.now());
  }
}
