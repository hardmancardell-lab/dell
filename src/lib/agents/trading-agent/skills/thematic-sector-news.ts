import { getGeopoliticalNews, computeCoverageSpike, type CoverageSpikeResult } from "./geopolitical-news";
import type { GeopoliticalNewsResult } from "../types";

/**
 * Real GDELT-backed macro news + coverage-spike read for thematic ETF
 * sleeves (cybersecurity, AI infrastructure, nuclear/uranium, quantum
 * computing) — same query-building/mechanism-note convention as
 * SECTOR_NEWS_KEYWORDS (sector-news-keywords.ts) and MAJOR_PAIR_KEYWORDS
 * (geopolitical-news.ts), extended to thematic sleeves that don't map onto
 * a single FMP GICS sector string.
 */
export const THEMATIC_SECTOR_KEYWORDS: Record<string, { label: string; query: string; mechanismNote: string }> = {
  cybersecurity: {
    label: "Cybersecurity",
    query: `(cybersecurity OR "data breach" OR ransomware OR "cyber attack" OR "cybersecurity regulation")`,
    mechanismNote: "Breach disclosures, ransomware incidents, and new cybersecurity regulation are the real events that move spend decisions and vendor stock prices in this sleeve.",
  },
  "ai-infrastructure": {
    label: "AI Infrastructure",
    query: `("data center" OR "AI infrastructure" OR hyperscaler OR "chip export controls" OR "AI capex")`,
    mechanismNote: "Hyperscaler capex guidance, data-center buildout announcements, and chip export-control policy are the dominant real news drivers for this sleeve.",
  },
  "nuclear-energy": {
    label: "Nuclear & Uranium",
    query: `(nuclear OR uranium OR "small modular reactor" OR SMR OR "nuclear power plant")`,
    mechanismNote: "Reactor approvals, uranium supply/enrichment news, and power-purchase-agreement announcements between utilities and data-center operators are the real catalysts here.",
  },
  "quantum-computing": {
    label: "Quantum Computing",
    query: `("quantum computing" OR "quantum chip" OR "quantum advantage" OR "quantum computer")`,
    mechanismNote: "Technical milestone claims (qubit counts, error-correction breakthroughs) and government/strategic-investment announcements are the real catalysts moving this sleeve's sentiment.",
  },
};

export interface ThematicSectorNewsEntry {
  themeKey: string;
  label: string;
  news: GeopoliticalNewsResult;
  coverageSpike: CoverageSpikeResult;
}

export interface ThematicSectorNewsResult {
  entries: ThematicSectorNewsEntry[];
  dataLimitations: string[];
}

/**
 * Runs every theme sequentially (not Promise.all) — GDELT enforces a real
 * ~1-request/5s rate limit, confirmed elsewhere in this codebase
 * (geopolitical-news.ts); parallel calls trip it.
 */
export async function getThematicSectorNews(themeKeys: string[]): Promise<ThematicSectorNewsResult> {
  const entries: ThematicSectorNewsEntry[] = [];
  const dataLimitations: string[] = [
    "GDELT is a global news-coverage-volume index, not a curated causal feed — a coverage spike means a topic is suddenly getting more news attention, correlated with but not proof of a market-moving event.",
  ];

  for (const key of themeKeys) {
    const theme = THEMATIC_SECTOR_KEYWORDS[key];
    if (!theme) {
      dataLimitations.push(`Unknown theme key "${key}" — skipped.`);
      continue;
    }
    const news = await getGeopoliticalNews(theme.query, theme.label, theme.mechanismNote);
    const coverageSpike = computeCoverageSpike(news.coverageVolume);
    entries.push({ themeKey: key, label: theme.label, news, coverageSpike });
  }

  return { entries, dataLimitations };
}
