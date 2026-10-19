"use client";

import { ResearchNotice } from "./ResearchNotice";
import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { WatchlistSelector } from "./WatchlistSelector";
import type { CryptoWatchlistSnapshot } from "@/lib/agents/trading-agent/skills/crypto-watchlist";

function fmtPrice(v: number | null): string {
  if (v === null) return "N/A";
  // Sub-dollar coins keep their precision: DOGE at $0.1234 must not read as $0.12.
  const digits = v >= 1 ? 2 : v >= 0.01 ? 4 : 8;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function Change({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: "var(--text-2)" }}>N/A</span>;
  return <span className={v > 0 ? "jv-pnl-up" : v < 0 ? "jv-pnl-down" : "jv-pnl-flat"}>{`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}</span>;
}

/**
 * The crypto watchlist: add Coinbase USD pairs (BTC becomes BTC-USD), see the last price and the rolling 24h / 7d
 * change. It shares the app's watchlist storage, so coins added here also appear on the Charts tab's quick-select.
 */
export function CryptoWatchlistTab() {
  const { entries, hydrated, addEntry, removeEntry } = useWatchlist();
  const coins = entries.filter((e) => e.assetClass === "crypto");
  const symbolsKey = coins.map((c) => c.symbol).join(",");
  const [input, setInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CryptoWatchlistSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  const load = useCallback(async () => {
    if (!symbolsKey) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto-watchlist?symbols=${encodeURIComponent(symbolsKey)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setSnapshot(json as CryptoWatchlistSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [symbolsKey]);

  useEffect(() => {
    if (hydrated) load();
  }, [hydrated, load]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (!addEntry(input, "crypto")) {
      setAddError("Enter a Coinbase USD pair such as BTC-USD (or just BTC).");
      return;
    }
    setAddError(null);
    track("watchlist_entry_added", { tab: "Crypto Watchlist", symbol: input.trim().toUpperCase(), metadata: { assetClass: "crypto" } });
    setInput("");
  }

  const bySymbol = new Map(snapshot?.rows.map((r) => [r.symbol, r]) ?? []);

  return (
    <div className="jarvis">
      <ResearchNotice source="Coinbase public market data (no key)" hypothetical={false}>
        Last price, with 24-hour and 7-day changes measured over rolling windows that end now.
      </ResearchNotice>
      <p className="jv-lede">
        Your crypto watchlist: last price and the rolling 24-hour and 7-day change for each Coinbase USD pair. Crypto trades
        around the clock, so these windows end now rather than at a market close. Add a coin here and it also appears on the
        Charts tab.
      </p>

      <WatchlistSelector />

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Coin, e.g. BTC or ETH-USD"
          className="jv-input flex-1 min-w-[180px]"
          aria-label="Coin or Coinbase USD pair"
        />
        <button type="submit" className="jv-btn">
          Add
        </button>
        <button type="button" onClick={load} disabled={loading || coins.length === 0} className="jv-btn-outline">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </form>
      {addError && (
        <p className="text-sm mb-3" style={{ color: "var(--danger)" }}>
          {addError}
        </p>
      )}

      {hydrated && coins.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          No coins on this watchlist yet. Add one above, for example BTC.
        </p>
      )}

      {error && (
        <div className="jv-card mb-3" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {coins.length > 0 && (
        <div className="overflow-x-auto">
          <table className="jv-table">
            <thead>
              <tr>
                <th className="text-left">Coin</th>
                <th className="text-right">Last (USD)</th>
                <th className="text-right">24h</th>
                <th className="text-right">7d</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {coins.map((c) => {
                const row = bySymbol.get(c.symbol);
                return (
                  <tr key={c.symbol}>
                    <td className="font-medium">{c.symbol}</td>
                    {row?.error ? (
                      <td colSpan={3} className="text-xs" style={{ color: "var(--danger)" }}>
                        {row.error}
                      </td>
                    ) : (
                      <>
                        <td className="jv-num">{row ? fmtPrice(row.lastPrice) : loading ? "…" : "N/A"}</td>
                        <td className="jv-num">{row ? <Change v={row.change24hPct} /> : loading ? "…" : "N/A"}</td>
                        <td className="jv-num">{row ? <Change v={row.change7dPct} /> : loading ? "…" : "N/A"}</td>
                      </>
                    )}
                    <td className="text-right">
                      <button
                        onClick={() => removeEntry(c.symbol, "crypto")}
                        aria-label={`Remove ${c.symbol}`}
                        style={{ color: "var(--text-2)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-2)")}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {snapshot && snapshot.dataLimitations.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {snapshot.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
              <div className="text-xs" style={{ color: "var(--verdict)" }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
