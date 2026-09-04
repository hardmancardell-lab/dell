import { fetchProfile } from "@/lib/data/fmp";

/**
 * FMP's /profile sector tag reflects the fund sponsor's own GICS
 * classification (often "Financial Services" for every ETF issuer), which
 * is meaningless for a thematic ETF holding — a CIBR investor cares that
 * it's cybersecurity exposure, not that the fund is issued by a financial
 * company. Overrides take priority over the FMP lookup below. Shared by
 * portfolio-valuation.ts (per-holding sector tagging) and
 * guided-trade-signals.ts (thematic-adjacency matching) — kept in one place
 * so the two never drift apart on what a symbol "is."
 */
export const THEMATIC_ETF_SECTOR_OVERRIDES: Record<string, string> = {
  CIBR: "Cybersecurity",
  DTCR: "Tech/AI Infrastructure",
  NLR: "Nuclear Energy",
  QTUM: "Quantum",
};

export async function getSectorForSymbol(symbol: string): Promise<string | null> {
  const override = THEMATIC_ETF_SECTOR_OVERRIDES[symbol.toUpperCase()];
  if (override) return override;
  try {
    const profiles = await fetchProfile(symbol);
    return profiles[0]?.sector ?? null;
  } catch {
    return null;
  }
}
