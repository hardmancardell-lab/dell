import { SECTOR_CONSTITUENTS } from "@/lib/agents/research-agent/skills/sector-fundamentals";
import { getPmVolumeSnapshot } from "./pm-volume-tracker";
import type { PmVolumeSnapshot, SectorScanSummary } from "../types";

// Same curated bellwether list Sector Fundamentals uses (see that file for why
// it's not a live market-cap screen) — reused here as the ticker universe for
// "sector" and "market" scans, since this app has no paid screener API.
const COVERAGE_CAVEAT =
  "Curated bellwether ticker list (not a live market-cap screen) — some sectors have zero available tickers on the free data tier. See Research Sources for why.";

async function scanTickers(sector: string, tickers: string[]): Promise<SectorScanSummary> {
  if (tickers.length === 0) {
    return {
      sector,
      results: [],
      tickersScanned: 0,
      tickersFlagged: 0,
      failedTickers: [],
      dataLimitations: [`No tickers available for "${sector}" on the free data tier.`, COVERAGE_CAVEAT],
    };
  }

  const settled = await Promise.all(
    tickers.map(async (ticker): Promise<{ ticker: string; snapshot: PmVolumeSnapshot | null; error: string | null }> => {
      try {
        const { snapshot } = await getPmVolumeSnapshot(ticker);
        return { ticker, snapshot, error: null };
      } catch (error) {
        return { ticker, snapshot: null, error: error instanceof Error ? error.message : "Unknown error" };
      }
    })
  );

  const results = settled.map((r) => r.snapshot).filter((s): s is PmVolumeSnapshot => s !== null);
  const failedTickers = settled.filter((r) => r.error !== null).map((r) => r.ticker);
  const tickersFlagged = results.filter((r) => r.isAnomaly).length;

  const dataLimitations = [COVERAGE_CAVEAT];
  if (failedTickers.length > 0) {
    dataLimitations.push(`Could not fetch: ${failedTickers.join(", ")}.`);
  }

  return { sector, results, tickersScanned: tickers.length, tickersFlagged, failedTickers, dataLimitations };
}

export async function scanSector(sector: string): Promise<SectorScanSummary> {
  const tickers = SECTOR_CONSTITUENTS[sector];
  if (!tickers) {
    throw new Error(`Unknown sector "${sector}".`);
  }
  return scanTickers(sector, tickers);
}

export async function scanMarket(): Promise<SectorScanSummary[]> {
  const sectors = Object.keys(SECTOR_CONSTITUENTS).filter((s) => SECTOR_CONSTITUENTS[s].length > 0);
  return Promise.all(sectors.map((s) => scanTickers(s, SECTOR_CONSTITUENTS[s])));
}
