import {
  fetchBalanceSheet,
  fetchCashFlowStatement,
  fetchIncomeStatement,
  fetchProfile,
} from "@/lib/data/fmp";
import { SECTOR_CONSTITUENTS, UNAVAILABLE_SECTOR_NOTE } from "./sector-fundamentals";
import type { PeerRatioRank, SectorPeerRanking } from "../types";

interface CompanyRatios {
  ticker: string;
  debtToEquity: number | null;
  interestCoverage: number | null;
  currentRatio: number | null;
  returnOnEquity: number | null;
  peRatio: number | null;
  pbRatio: number | null;
}

const RATIO_DEFS: { key: keyof Omit<CompanyRatios, "ticker">; label: string; unit: string; higherIsBetter: boolean }[] = [
  { key: "debtToEquity", label: "Debt / Equity", unit: "x", higherIsBetter: false },
  { key: "interestCoverage", label: "Interest Coverage", unit: "x", higherIsBetter: true },
  { key: "currentRatio", label: "Current Ratio", unit: "x", higherIsBetter: true },
  { key: "returnOnEquity", label: "Return on Equity", unit: "%", higherIsBetter: true },
  { key: "peRatio", label: "P/E (cheapness, not quality)", unit: "x", higherIsBetter: false },
  { key: "pbRatio", label: "P/B (cheapness, not quality)", unit: "x", higherIsBetter: false },
];

async function fetchCompanyRatios(ticker: string): Promise<CompanyRatios> {
  const [profiles, income, balance] = await Promise.all([
    fetchProfile(ticker),
    fetchIncomeStatement(ticker, 1),
    fetchBalanceSheet(ticker, 1),
  ]);
  const profile = profiles[0];
  const latestIncome = income[0];
  const latestBalance = balance[0];

  const debtToEquity =
    latestBalance && latestBalance.totalStockholdersEquity !== 0
      ? latestBalance.totalDebt / latestBalance.totalStockholdersEquity
      : null;
  const interestCoverage =
    latestIncome && latestIncome.interestExpense > 0
      ? latestIncome.operatingIncome / latestIncome.interestExpense
      : null;
  const currentRatio =
    latestBalance && latestBalance.totalCurrentLiabilities > 0
      ? latestBalance.totalCurrentAssets / latestBalance.totalCurrentLiabilities
      : null;
  const returnOnEquity =
    latestIncome && latestBalance && latestBalance.totalStockholdersEquity > 0
      ? (latestIncome.netIncome / latestBalance.totalStockholdersEquity) * 100
      : null;
  const peRatio =
    profile && latestIncome && latestIncome.eps > 0 ? profile.price / latestIncome.eps : null;
  const bookValuePerShare =
    latestBalance && latestIncome && latestIncome.weightedAverageShsOut > 0
      ? (latestBalance.totalStockholdersEquity - (latestBalance.preferredStock || 0)) /
        latestIncome.weightedAverageShsOut
      : null;
  const pbRatio = profile && bookValuePerShare && bookValuePerShare > 0 ? profile.price / bookValuePerShare : null;

  return { ticker, debtToEquity, interestCoverage, currentRatio, returnOnEquity, peRatio, pbRatio };
}

function rankAmong(
  target: CompanyRatios,
  peers: CompanyRatios[],
  def: (typeof RATIO_DEFS)[number]
): PeerRatioRank {
  const all = [target, ...peers];
  const withValues = all
    .map((c) => ({ ticker: c.ticker, value: c[def.key] }))
    .filter((c): c is { ticker: string; value: number } => c.value !== null);

  const sorted = [...withValues].sort((a, b) => (def.higherIsBetter ? b.value - a.value : a.value - b.value));
  const targetIndex = sorted.findIndex((c) => c.ticker === target.ticker);
  const rank = targetIndex >= 0 ? targetIndex + 1 : null;
  const percentile =
    rank !== null && sorted.length > 1 ? ((sorted.length - rank) / (sorted.length - 1)) * 100 : null;

  return {
    ratioLabel: def.label,
    unit: def.unit,
    higherIsBetter: def.higherIsBetter,
    targetValue: target[def.key],
    peerValues: peers.map((p) => ({ ticker: p.ticker, value: p[def.key] })),
    rank,
    totalRanked: withValues.length,
    percentile,
  };
}

/**
 * Opt-in only — this fetches ~4-6 peer companies plus the target (each a
 * profile + income + balance call), which is real FMP quota spend. The
 * caller (the UI) must gate this behind an explicit user action, not fetch
 * it automatically alongside the main security analysis.
 */
export async function getSectorPeerRanking(ticker: string): Promise<SectorPeerRanking> {
  const symbol = ticker.trim().toUpperCase();
  const dataLimitations: string[] = [
    "Sector grouping uses FMP's own sector/industry taxonomy, not NAICS codes — FMP's free tier doesn't expose NAICS classification.",
    "Peer set is the same curated large-cap sample used in Sector Fundamentals, not a full sector census (FMP's screener endpoint requires a paid plan).",
  ];

  const targetProfiles = await fetchProfile(symbol);
  const targetProfile = targetProfiles[0];
  if (!targetProfile) {
    throw new Error(`No profile data found for ticker "${symbol}".`);
  }

  const sectorLabel = targetProfile.sector;
  const peerTickers = (SECTOR_CONSTITUENTS[sectorLabel] ?? []).filter((t) => t !== symbol);

  if (peerTickers.length === 0) {
    const detail = UNAVAILABLE_SECTOR_NOTE[sectorLabel];
    throw new Error(
      detail
        ? `Peer ranking not available for sector "${sectorLabel}": ${detail}`
        : `No curated peer list defined for sector "${sectorLabel}".`
    );
  }

  const [targetRatios, peerSettled] = await Promise.all([
    fetchCompanyRatios(symbol),
    Promise.allSettled(peerTickers.map((t) => fetchCompanyRatios(t))),
  ]);

  const peerRatios = peerSettled
    .filter((r): r is PromiseFulfilledResult<CompanyRatios> => r.status === "fulfilled")
    .map((r) => r.value);
  const failedPeers = peerTickers.filter((_, i) => peerSettled[i].status === "rejected");
  if (failedPeers.length > 0) {
    dataLimitations.push(
      `Could not fetch peer data for: ${failedPeers.join(", ")} — likely restricted on the free FMP tier.`
    );
  }

  const rankings = RATIO_DEFS.map((def) => rankAmong(targetRatios, peerRatios, def));

  return {
    ticker: symbol,
    sectorLabel,
    classificationNote: `FMP sector: "${sectorLabel}" (industry: "${targetProfile.industry}").`,
    peerTickers: peerRatios.map((p) => p.ticker),
    rankings,
    dataLimitations,
  };
}
