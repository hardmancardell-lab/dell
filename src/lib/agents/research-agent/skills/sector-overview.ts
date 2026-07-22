import { fetchFredSeries, latest, yoyPercentChange } from "@/lib/data/fred";
import type {
  IndustryGroup,
  SectorClassification,
  SectorSelectionMatrix,
  UnavailableMetric,
} from "../types";

// Approximate long-run average capacity utilization by industry group
// (Fed G.17 historical data, ~1972-2019). Directional, not precise.
const INDUSTRY_GROUPS = [
  {
    id: "manufacturing",
    label: "Manufacturing",
    productionSeriesId: "IPMAN",
    capacitySeriesId: "CUMFNS",
    longRunAvg: 77,
  },
  {
    id: "durable-manufacturing",
    label: "Durable Manufacturing",
    productionSeriesId: "IPDMAN",
    capacitySeriesId: "CAPUTLG3361T3S",
    longRunAvg: 75,
  },
  {
    id: "nondurable-manufacturing",
    label: "Nondurable Manufacturing",
    productionSeriesId: "IPNMAN",
    capacitySeriesId: "CAPUTLG325S",
    longRunAvg: 79,
  },
  {
    id: "mining",
    label: "Mining",
    productionSeriesId: "IPMINE",
    capacitySeriesId: "CAPUTLG21S",
    longRunAvg: 87,
  },
  {
    id: "utilities",
    label: "Utilities",
    productionSeriesId: "IPUTIL",
    capacitySeriesId: "CAPUTLG2211A2S",
    longRunAvg: 85,
  },
] as const;

function classify(
  capacityUtilization: number,
  longRunAvg: number
): SectorClassification {
  if (capacityUtilization < longRunAvg - 3) return "cyclical-bargain-candidate";
  if (capacityUtilization > longRunAvg + 3) return "overheated";
  return "normal";
}

const UNAVAILABLE_METRICS: UnavailableMetric[] = [
  {
    label: "Sector Debt-to-Equity / Interest Coverage medians",
    note: "Now available at /sector-fundamentals for 8 of 11 sectors, via a curated large-cap sample from Financial Modeling Prep (free tier restricts full statement access to an undocumented ticker allowlist — Basic Materials, Real Estate, and Utilities came back with zero accessible tickers and aren't covered). A paid FMP plan would close the remaining gap and cover the full sector, not just a curated sample.",
  },
  {
    label: "Sector Credit Rating Migrations",
    note: "Requires rating-agency data (S&P, Moody's) by industry — not available via a free API. Would need a ratings data feed or a licensed agency API.",
  },
  {
    label: "Sector Gross/Operating Margin Variance",
    note: "Now available at /sector-fundamentals for 8 of 11 sectors (see Debt-to-Equity note above for the same coverage caveat), based on up to 5 years of history (FMP free tier cap) rather than Graham's requested 7-10 years.",
  },
  {
    label: "Sector CAPE Ratio",
    note: "Requires a sector price index plus 7-10yr rolling aggregate earnings by sector — not on FRED, and not solved by the FMP integration either (FMP's free tier doesn't include analyst estimates or long-run earnings series). Could be derived from sector ETF prices (e.g. SPDR sector ETFs) combined with constituent earnings from a paid fundamentals plan.",
  },
  {
    label: "Sector CapEx-to-Depreciation Ratio",
    note: "Now available at /sector-fundamentals for 8 of 11 sectors (see Debt-to-Equity note above for the same coverage caveat).",
  },
  {
    label: "Commodity Input/Output Spreads (crack spreads, crush spreads, etc.)",
    note: "Available from EIA (energy) and USDA (agriculture) APIs, not FRED. Not yet wired up.",
  },
];

export async function getSectorOverview(): Promise<SectorSelectionMatrix> {
  const groupResults = await Promise.all(
    INDUSTRY_GROUPS.map(async (group) => {
      const [production, capacity] = await Promise.all([
        fetchFredSeries(group.productionSeriesId, 24),
        fetchFredSeries(group.capacitySeriesId, 10),
      ]);
      const latestProduction = latest(production);
      const latestCapacity = latest(capacity);
      if (!latestProduction || !latestCapacity) {
        throw new Error(
          `No recent data for industry group ${group.id} (${group.productionSeriesId}/${group.capacitySeriesId}).`
        );
      }
      const industrialProductionYoY = yoyPercentChange(production, 12);
      const result: IndustryGroup = {
        id: group.id,
        label: group.label,
        industrialProduction: {
          seriesId: group.productionSeriesId,
          label: `Industrial Production: ${group.label}`,
          date: latestProduction.date,
          value: latestProduction.value,
          unit: "index",
        },
        industrialProductionYoY,
        capacityUtilization: {
          seriesId: group.capacitySeriesId,
          label: `Capacity Utilization: ${group.label}`,
          date: latestCapacity.date,
          value: latestCapacity.value,
          unit: "percent of capacity",
        },
        capacityUtilizationLongRunAvg: group.longRunAvg,
        classification: classify(latestCapacity.value, group.longRunAvg),
      };
      return result;
    })
  );

  const inventoryToSalesRaw = await fetchFredSeries("ISRATIO", 10);
  const latestInventoryToSales = latest(inventoryToSalesRaw);
  if (!latestInventoryToSales) {
    throw new Error("No recent data for ISRATIO (Total Business Inventories to Sales Ratio).");
  }

  const cyclicalBargainCandidates = groupResults
    .filter((g) => g.classification === "cyclical-bargain-candidate")
    .map((g) => g.id);

  return {
    industryGroups: groupResults,
    inventoryToSales: {
      totalBusiness: {
        seriesId: "ISRATIO",
        label: "Total Business Inventories to Sales Ratio",
        date: latestInventoryToSales.date,
        value: latestInventoryToSales.value,
        unit: "ratio",
      },
      note: "Economy-wide (Census MTIS), not broken out by GICS sector. A spike above its historical range signals broad oversupply pressure.",
    },
    unavailable: UNAVAILABLE_METRICS,
    cyclicalBargainCandidates,
  };
}
