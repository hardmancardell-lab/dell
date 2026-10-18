import { getLatestOutlookVersion, isEconomicOutlookDbConfigured, listScorecardEntries } from "@/lib/agents/economic-outlook/storage";
import type { EconomicOutlook, ScorecardEntry } from "@/lib/agents/economic-outlook/types";
import { upcomingCatalysts } from "@/lib/agents/trading-agent/skills/catalyst-calendar";
import type { UpcomingCatalyst } from "@/lib/agents/trading-agent/skills/catalyst-calendar";
import { getCryptoRegime } from "@/lib/agents/trading-agent/skills/crypto-regime-service";
import type { CryptoRegimeResult } from "@/lib/agents/trading-agent/skills/crypto-regime-service";
import type { CheckStatus, RegimeCheck, RegimeLabel } from "@/lib/agents/trading-agent/skills/crypto-regime";
import { FetchBudget, ResearchCache, Semaphore } from "./cache";
import type { ResearchTargets } from "./holdings";
import type { CatalystView, CryptoRegimeView, OutlookView, ResearchEnvironment, ScorecardSummary } from "./types";

/**
 * The "environment" half of the client Research section: the economic outlook, dated catalysts for the client's own
 * holdings, the market-wide crypto read (only if the client holds crypto) and the outlook scorecard counts.
 *
 * Client-safe by construction. From the outlook it keeps the regime, the glance summary, the indicator readings with their
 * sources, the two risk lists and the data limitations. It drops tradingParameters (volatility regime, calendar effects,
 * event-vol catalysts), selfQa, gapAnalysis, the trigger feed and the narrative reference: those are trading-desk content.
 * Nothing read from an upstream error is passed on.
 */

export interface EnvironmentDeps {
  outlook(): Promise<EconomicOutlook | null>;
  scorecard(): Promise<ScorecardEntry[]>;
  crypto(): Promise<CryptoRegimeResult>;
  outlookConfigured(): boolean;
  now(): number;
  today(): string;
}

export const defaultEnvDeps: EnvironmentDeps = {
  outlook: () => getLatestOutlookVersion(),
  scorecard: () => listScorecardEntries(),
  crypto: () => getCryptoRegime(),
  outlookConfigured: () => isEconomicOutlookDbConfigured(),
  now: () => Date.now(),
  today: () => new Date().toISOString().slice(0, 10),
};
let deps: EnvironmentDeps = defaultEnvDeps;

function makeCaches() {
  return {
    outlook: new ResearchCache<{ outlook: EconomicOutlook | null; scorecard: ScorecardEntry[] | null }>(30 * 60_000, 24 * 60 * 60_000, new FetchBudget(20), new Semaphore(1), () => deps.now()),
    crypto: new ResearchCache<CryptoRegimeResult>(15 * 60_000, 24 * 60 * 60_000, new FetchBudget(20), new Semaphore(1), () => deps.now()),
  };
}
let caches = makeCaches();

/** Test seam: swap the upstream calls and start with empty caches and fresh budgets. */
export function __setEnvironmentDepsForTests(next: Partial<EnvironmentDeps> | null): void {
  deps = { ...defaultEnvDeps, ...(next ?? {}) };
  caches = makeCaches();
}

const clip = (s: unknown, n = 700): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const CYCLE_PLAIN: Record<string, string> = {
  early_expansion: "early expansion",
  mid_expansion: "middle of an expansion",
  late_expansion: "late expansion",
  slowdown: "slowdown",
  contraction: "contraction",
  recovery: "recovery",
};

/** Pure. Exported for tests. */
export function shapeOutlook(o: EconomicOutlook): OutlookView {
  const indicators = [...(o.dualMandateScorecard?.labor ?? []), ...(o.dualMandateScorecard?.inflation ?? []), ...(o.growthAndFinancialConditions ?? [])]
    .slice(0, 12)
    .map((i) => ({ indicator: clip(i.indicator, 120), currentReading: clip(i.currentReading, 200), source: clip(i.source, 120), role: clip(i.roleInOutlook, 300) }));
  const risk = (r: { scenario: string; trigger: string; marketImplication: string }) => ({ scenario: clip(r.scenario, 300), trigger: clip(r.trigger, 300), marketImplication: clip(r.marketImplication, 300) });
  return {
    asOfDate: clip(o.meta?.asOfDate, 32),
    nextScheduledRefresh: clip(o.meta?.nextScheduledRefresh, 32),
    regime: {
      label: clip(o.regimeTag?.label, 160),
      cyclePhase: CYCLE_PLAIN[o.regimeTag?.cyclePhase] ?? clip(o.regimeTag?.cyclePhase, 60),
      financialConditions: clip(o.regimeTag?.financialConditionsStance, 40),
      dualMandateBalance: clip(o.regimeTag?.dualMandateBalance, 300),
    },
    glance: clip(o.outputLayers?.glance, 1200),
    policy: {
      currentTargetRange: clip(o.policyStance?.currentTargetRange, 80),
      houseViewPath: clip(o.policyStance?.houseViewPath, 400),
      marketImpliedPath: clip(o.policyStance?.marketImpliedPath, 400),
    },
    indicators,
    upsideRisks: (o.riskBalance?.upsideRisks ?? []).slice(0, 4).map(risk),
    downsideRisks: (o.riskBalance?.downsideRisks ?? []).slice(0, 4).map(risk),
    dataLimitations: (o.dataLimitations ?? []).slice(0, 6).map((d) => clip(d, 400)),
  };
}

/** Pure. Only counts leave the scorecard, never the free-text grading notes or the trigger lists. */
export function summarizeScorecard(entries: ScorecardEntry[]): ScorecardSummary {
  const graded = entries.filter((e) => e.grading?.gradedDate);
  return {
    logged: entries.length,
    graded: graded.length,
    regimeRight: graded.filter((e) => e.grading.wasRegimeTagCorrect === true).length,
    regimeWrong: graded.filter((e) => e.grading.wasRegimeTagCorrect === false).length,
    pathRight: graded.filter((e) => e.grading.wasHouseViewPathCorrect === true).length,
    pathWrong: graded.filter((e) => e.grading.wasHouseViewPathCorrect === false).length,
  };
}

const LABEL_PLAIN: Record<RegimeLabel, string> = {
  breakout: "Most of the six conditions are met.",
  mixed: "Some of the six conditions are met.",
  "range-bound": "Few of the six conditions are met.",
  undetermined: "Some inputs are missing, so the read is not clear.",
};

function readingText(c: RegimeCheck): string {
  const r = c.reading;
  if (r === null) return "not available";
  switch (c.unit) {
    case "pct":
    case "ratio-to-average":
      return `${r >= 0 ? "+" : "-"}${Math.abs(r * 100).toFixed(1)}%`;
    case "share":
      return `${(r * 100).toFixed(1)}%`;
    case "musd":
      return `${r >= 0 ? "+" : "-"}$${Math.abs(r).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
    case "yield":
      return `${r.toFixed(2)}%`;
    case "index":
      return String(Math.round(r));
  }
}

/** Pure. Source rows carry the source name and whether it was read, never the provider's error text. */
export function shapeCrypto(r: CryptoRegimeResult): CryptoRegimeView {
  const failed = r.sources.filter((s) => s.status === "error").length;
  return {
    asOf: r.asOf,
    label: r.regime.label,
    labelPlain: LABEL_PLAIN[r.regime.label],
    met: r.regime.met,
    total: r.regime.total,
    unavailable: r.regime.unavailable,
    checks: r.regime.checks.map((c) => ({ label: c.label, status: c.status as CheckStatus, reading: readingText(c), threshold: c.threshold })),
    sources: r.sources.map((s) => ({ label: s.label, source: s.source, status: s.status === "error" ? "not read" : s.status === "typed-in" ? "typed in" : "read", asOf: s.asOf ?? null })),
    limitations: [
      "This is a market-wide read of six liquidity and trend conditions. It is not about any one coin and it does not predict prices.",
      ...(failed > 0 ? [`${failed} of the data sources could not be read, so those conditions show as not available and never count as met.`] : []),
      "Free public data is used. It can be delayed or briefly missing.",
    ],
  };
}

function catalystView(e: UpcomingCatalyst, appliesTo: string[]): CatalystView {
  return {
    id: e.id,
    date: e.date,
    time: e.time ?? null,
    name: e.name,
    impact: e.impactForSymbol,
    daysAway: e.daysAway,
    appliesTo,
    note: e.note ?? null,
    basis: e.basis,
    sourceUrl: e.sourceUrl ?? null,
  };
}

const IMPACT_RANK = { low: 0, medium: 1, high: 2 } as const;

/** Reads the checked-in calendar only (no outside call). One query per kind of holding, merged by event. */
export function catalystsFor(targets: ResearchTargets, today: string): NonNullable<ResearchEnvironment["catalysts"]> {
  const groups: { symbol: string | undefined; names: string[] }[] = [];
  if (targets.catalystSymbols.equity.length) groups.push({ symbol: targets.catalystSymbols.equity[0], names: targets.catalystSymbols.equity });
  if (targets.catalystSymbols.crypto.length) groups.push({ symbol: targets.catalystSymbols.crypto[0], names: targets.catalystSymbols.crypto });
  for (const p of targets.catalystSymbols.forex.slice(0, 4)) groups.push({ symbol: p, names: [p] });
  const noHoldings = groups.length === 0;
  if (noHoldings) groups.push({ symbol: undefined, names: [] });

  const merged = new Map<string, CatalystView>();
  const notes = new Set<string>();
  let verifiedOn = "";
  for (const g of groups) {
    const res = upcomingCatalysts({ days: 30, symbol: g.symbol, minImpact: noHoldings ? "high" : "medium" }, today);
    verifiedOn = res.verifiedOn;
    res.notes.slice(0, 3).forEach((n) => notes.add(n));
    for (const e of res.events) {
      const prev = merged.get(e.id);
      if (prev) {
        prev.appliesTo = [...new Set([...prev.appliesTo, ...g.names])];
        if (IMPACT_RANK[e.impactForSymbol] > IMPACT_RANK[prev.impact]) prev.impact = e.impactForSymbol;
      } else {
        merged.set(e.id, catalystView(e, g.names));
      }
    }
  }
  const events = [...merged.values()].sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date))).slice(0, 12);
  return {
    verifiedOn,
    events,
    notes: [...notes].slice(0, 4),
    scope: noHoldings ? "No holdings are on file, so this lists the high-impact market-wide dates." : "Dates that matter most for the kinds of holdings you have. Medium and high impact only.",
  };
}

/** Never throws. Each part fails on its own and says so in plain words. */
export async function getEnvironment(targets: ResearchTargets): Promise<ResearchEnvironment> {
  const outlookP = (async () => {
    if (!deps.outlookConfigured()) return { kind: "none" as const };
    try {
      const c = await caches.outlook.get("outlook", async () => {
        const outlook = await deps.outlook();
        let scorecard: ScorecardEntry[] | null = null;
        try {
          scorecard = await deps.scorecard();
        } catch {
          scorecard = null;
        }
        return { outlook, scorecard };
      });
      return { kind: "ok" as const, ...c };
    } catch {
      return { kind: "error" as const };
    }
  })();
  const cryptoP = (async () => {
    if (!targets.holdsCrypto) return null;
    try {
      return await caches.crypto.get("crypto", () => deps.crypto());
    } catch {
      return "error" as const;
    }
  })();
  const [o, c] = await Promise.all([outlookP, cryptoP]);

  let outlook: OutlookView | null = null;
  let outlookNote: string | null = null;
  let scorecard: ScorecardSummary | null = null;
  let scorecardNote: string | null = null;
  let stale = false;
  if (o.kind === "ok") {
    stale = o.stale;
    if (o.value.outlook) outlook = shapeOutlook(o.value.outlook);
    else outlookNote = "No economic outlook has been published yet.";
    if (o.value.scorecard) scorecard = summarizeScorecard(o.value.scorecard);
    else scorecardNote = "The track record is not available right now.";
  } else {
    outlookNote = "The economic outlook is not available right now.";
    scorecardNote = "The track record is not available right now.";
  }

  let crypto: CryptoRegimeView | null = null;
  let cryptoNote: string | null = null;
  if (c === "error") cryptoNote = "The crypto read is not available right now.";
  else if (c) {
    crypto = shapeCrypto(c.value);
    stale = stale || c.stale;
  }

  return {
    asOf: new Date(deps.now()).toISOString(),
    outlook,
    outlookNote,
    catalysts: catalystsFor(targets, deps.today()),
    crypto,
    cryptoNote,
    scorecard,
    scorecardNote,
    stale,
  };
}
