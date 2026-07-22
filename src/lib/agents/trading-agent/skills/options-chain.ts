import { fetchOptionsChain } from "@/lib/data/market-data";
import type { MarketOptionContract } from "@/lib/data/market-data-types";
import type { OptionsChainSummary } from "../types";

function sumOi(contracts: MarketOptionContract[]): number {
  return contracts.reduce((sum, c) => sum + c.openInterest, 0);
}

function sumVolume(contracts: MarketOptionContract[]): number {
  return contracts.reduce((sum, c) => sum + c.totalVolume, 0);
}

export async function getOptionsChainSummary(
  ticker: string,
  expirationDate?: string
): Promise<OptionsChainSummary> {
  const symbol = ticker.trim().toUpperCase();
  const chain = await fetchOptionsChain(symbol, expirationDate);

  const dataLimitations: string[] = [
    "Single-snapshot view only — this does not track how OI/volume changed over the past 1-2 weeks, which is what actually signals conviction (see 'Not Yet Available' on the PM-Volume Tracker page).",
  ];
  if (chain.calls.length === 0 && chain.puts.length === 0) {
    dataLimitations.push(
      "No contracts returned — could mean this ticker has no listed options, the expiration filter excluded everything, or Schwab's chain response field names differ from what this app expects (unconfirmed until live-verified)."
    );
  }

  const totalCallOpenInterest = sumOi(chain.calls);
  const totalPutOpenInterest = sumOi(chain.puts);
  const totalCallVolume = sumVolume(chain.calls);
  const totalPutVolume = sumVolume(chain.puts);

  const strikeMap = new Map<
    number,
    { callOpenInterest: number; callVolume: number; putOpenInterest: number; putVolume: number }
  >();
  for (const c of chain.calls) {
    const entry = strikeMap.get(c.strikePrice) ?? { callOpenInterest: 0, callVolume: 0, putOpenInterest: 0, putVolume: 0 };
    entry.callOpenInterest += c.openInterest;
    entry.callVolume += c.totalVolume;
    strikeMap.set(c.strikePrice, entry);
  }
  for (const p of chain.puts) {
    const entry = strikeMap.get(p.strikePrice) ?? { callOpenInterest: 0, callVolume: 0, putOpenInterest: 0, putVolume: 0 };
    entry.putOpenInterest += p.openInterest;
    entry.putVolume += p.totalVolume;
    strikeMap.set(p.strikePrice, entry);
  }

  const strikes = Array.from(strikeMap.entries())
    .map(([strikePrice, v]) => ({ strikePrice, ...v }))
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return {
    ticker: symbol,
    expirationDate: expirationDate ?? null,
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalCallVolume,
    totalPutVolume,
    putCallVolumeRatio: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : null,
    putCallOpenInterestRatio: totalCallOpenInterest > 0 ? totalPutOpenInterest / totalCallOpenInterest : null,
    strikes,
    dataLimitations,
  };
}
