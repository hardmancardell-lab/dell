import { windowExpirations } from "./gex-signal";
import { OPTION_FLOW_CONFIG, bucketStartMs, buildOptionFlowRow, sessionDateET } from "./option-flow-snapshot";
import type { DataFeed, FlowChain, OptionFlowRow } from "./option-flow-snapshot";
import type { MarketOptionsChain } from "@/lib/data/market-data-types";

/**
 * Server side of the option-flow logger: for each symbol, fetch the quote, the expirations and the chains, then hand
 * everything to the pure row builder. Every provider and database call comes in through `deps`, so the cron route
 * wires the real ones and the tests wire stubs (no network, no database).
 */

export interface OptionFlowDeps {
  /** `feed` is passed on every call (never held in module state) so one request can never cross-contaminate another. */
  getExpirations(symbol: string, feed: DataFeed): Promise<string[]>;
  fetchChain(symbol: string, expiration: string, feed: DataFeed): Promise<MarketOptionsChain>;
  fetchQuote(symbol: string): Promise<{ lastPrice: number }>;
  getPrevious(symbol: string, sessionDate: string, beforeSnapshotTimeIso: string): Promise<OptionFlowRow | null>;
  getPriorSessionFinal(symbol: string, sessionDate: string): Promise<OptionFlowRow | null>;
  upsert(row: OptionFlowRow): Promise<void>;
}

export interface SymbolTickResult {
  symbol: string;
  ok: boolean;
  snapshotTime?: string;
  /** All provider calls for this symbol (quote + expirations + chains). */
  providerCalls: number;
  /** Tradier calls (expirations + chains). */
  tradierCalls: number;
  elapsedMs: number;
  oiPass?: boolean;
  flags?: string[];
  error?: string;
}

export interface OptionFlowTickResult {
  snapshotTime: string;
  results: SymbolTickResult[];
}

const CHAIN_BATCH = 3;
/** An hour of slack: expiryMs() in gex-signal.ts assumes a 20:00 UTC expiry (4pm EDT), which in winter is 3pm EST, so 0DTE would drop out of the window an hour early. Shifting `now` back keeps it in until the real close in both seasons. */
const EXPIRY_SLACK_MS = 3_600_000;

async function fetchChainsBatched(symbol: string, expirations: string[], deps: OptionFlowDeps, feed: DataFeed): Promise<FlowChain[]> {
  const out: FlowChain[] = [];
  for (let i = 0; i < expirations.length; i += CHAIN_BATCH) {
    const batch = expirations.slice(i, i + CHAIN_BATCH);
    const got = await Promise.all(batch.map((e) => deps.fetchChain(symbol, e, feed).catch(() => null)));
    batch.forEach((e, k) => out.push({ expiration: e, chain: got[k] }));
  }
  return out;
}

/** Runs one symbol. `claimOiPass` is asked after the cheap calls succeed; it returns true when this symbol may spend the extra calls on the OI window. */
async function snapshotSymbol(symbol: string, nowMs: number, deps: OptionFlowDeps, feed: DataFeed, claimOiPass: () => boolean): Promise<SymbolTickResult> {
  const started = Date.now();
  let providerCalls = 0, tradierCalls = 0;
  try {
    const bucketIso = new Date(bucketStartMs(nowMs)).toISOString();
    const sessionDate = sessionDateET(nowMs);
    const [quote, expirations, previous] = await Promise.all([
      (providerCalls++, deps.fetchQuote(symbol)),
      (providerCalls++, tradierCalls++, deps.getExpirations(symbol, feed)),
      deps.getPrevious(symbol, sessionDate, bucketIso),
    ]);
    if (!(quote.lastPrice > 0)) throw new Error(`No usable quote for ${symbol}.`);
    if (expirations.length === 0) throw new Error(`No option expirations found for "${symbol}".`);

    const c = OPTION_FLOW_CONFIG;
    const slackNow = nowMs - EXPIRY_SLACK_MS;
    const flowExps = windowExpirations(expirations, slackNow, c.flowWindowDays, c.flowMaxExpirations);
    if (flowExps.length === 0) throw new Error(`No expirations inside the ${c.flowWindowDays}-day flow window for "${symbol}".`);

    // Open interest changes overnight, so the wider window is fetched once per session and carried forward by the row builder.
    const needsOi = !previous || previous.oi_call === null;
    const doOi = needsOi && claimOiPass();
    const wanted = doOi ? windowExpirations(expirations, slackNow, c.oiWindowDays, c.oiMaxExpirations) : flowExps;
    const wantedAll = [...new Set([...flowExps, ...wanted])];

    const chains = await fetchChainsBatched(symbol, wantedAll, deps, feed);
    providerCalls += chains.length;
    tradierCalls += chains.length;
    const byExp = new Map(chains.map((x) => [x.expiration, x]));
    const flowChains = flowExps.map((e) => byExp.get(e) as FlowChain);
    if (flowChains.every((x) => !x.chain)) throw new Error(`Every flow-window chain failed to load for "${symbol}".`);

    const priorSessionFinal = previous ? null : await deps.getPriorSessionFinal(symbol, sessionDate);
    const row = buildOptionFlowRow({
      symbol,
      spot: quote.lastPrice,
      fetchedAtMs: nowMs,
      flowChains,
      oiChains: doOi ? wanted.map((e) => byExp.get(e) as FlowChain) : null,
      previous,
      priorSessionFinal,
      providerCalls,
      dataFeed: feed,
    });
    await deps.upsert(row);
    return { symbol, ok: true, snapshotTime: row.snapshot_time, providerCalls, tradierCalls, elapsedMs: Date.now() - started, oiPass: doOi, flags: row.flags };
  } catch (err) {
    return { symbol, ok: false, providerCalls, tradierCalls, elapsedMs: Date.now() - started, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * One cron tick. Symbols run with modest concurrency; each has its own try/catch so one failure never fails the
 * others. At most `maxOiPassesPerRun` symbols spend the extra calls on the 45-day open-interest window per tick
 * (the rest do it on a later tick), which keeps the first tick of the day inside Tradier's per-minute limit.
 */
export async function runOptionFlowTick(opts: {
  nowMs: number;
  symbols: readonly string[];
  deps: OptionFlowDeps;
  /** The Tradier environment for the whole tick. Required, no default: the caller (the cron route) decides explicitly. */
  feed: DataFeed;
  concurrency?: number;
  maxOiPassesPerRun?: number;
  /** Stop starting new symbols after this many ms (the route has a 60 s budget). */
  budgetMs?: number;
}): Promise<OptionFlowTickResult> {
  const { nowMs, symbols, deps, feed } = opts;
  if (feed !== "sandbox" && feed !== "production") throw new Error('runOptionFlowTick needs feed "sandbox" or "production".');
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const budgetMs = opts.budgetMs ?? 50_000;
  let oiLeft = opts.maxOiPassesPerRun ?? 2;
  const claim = () => (oiLeft > 0 ? (oiLeft--, true) : false);
  const started = Date.now();
  const results: SymbolTickResult[] = new Array(symbols.length);
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const i = next++;
      results[i] =
        Date.now() - started > budgetMs
          ? { symbol: symbols[i], ok: false, providerCalls: 0, tradierCalls: 0, elapsedMs: 0, error: "Skipped: time budget for this run was used up." }
          : await snapshotSymbol(symbols[i], nowMs, deps, feed, claim);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return { snapshotTime: new Date(bucketStartMs(nowMs)).toISOString(), results };
}
