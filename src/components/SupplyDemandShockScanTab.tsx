"use client";

import { useState } from "react";
import { ShockScanEntryCard } from "./ShockScanEntryCard";
import type { AssetClass, PortfolioHolding, PortfolioShockScanResult } from "@/lib/agents/trading-agent/types";

/**
 * Same real GDELT coverage-spike + PhD-persona scan that powers the Portfolio
 * Tracker's "Macro Supply/Demand Shock Scan," but usable for any symbol —
 * you don't need to actually hold the position to check whether it's in the
 * middle of a real, news-confirmed supply or demand shock right now. Built
 * by POSTing a single synthetic holding to the existing /api/portfolio-shock-scan
 * endpoint rather than a new backend path — the endpoint only ever reads
 * symbol/assetClass off each holding.
 */
export function SupplyDemandShockScanTab({ assetClass, defaultTicker }: { assetClass: AssetClass; defaultTicker: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [result, setResult] = useState<PortfolioShockScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const syntheticHolding: PortfolioHolding = {
        id: "scan",
        symbol: ticker.trim().toUpperCase(),
        assetClass,
        shares: 1,
        costBasisPerShare: 0,
        acquiredDate: new Date().toISOString().slice(0, 10),
      };
      const res = await fetch("/api/portfolio-shock-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: [syntheticHolding] }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as PortfolioShockScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis flex flex-col gap-4">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Checks whether this symbol&apos;s underlying sector/pair/commodity is seeing a real, unusual spike in news
        coverage right now (GDELT), and — if so — a PhD-economist-persona read on whether it looks like a supply-side
        or demand-side shock. Real time to run (GDELT rate-limits to ~1 request/5s).
      </p>

      <form onSubmit={run} className="flex items-end gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Symbol</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input w-36" />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Scanning…" : "Run Scan"}
        </button>
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {result.entries.length === 0 && result.dataLimitations.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>No news-query mapping found for this symbol — nothing to scan.</p>
          )}
          {result.entries.map((e) => (
            <ShockScanEntryCard key={e.query} entry={e} />
          ))}
          {result.dataLimitations.length > 0 && (
            <div className="flex flex-col gap-2">
              {result.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                  <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
