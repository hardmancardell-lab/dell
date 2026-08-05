"use client";

import { useEffect, useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import { PaperOrderForm, type PrefillOption } from "./PaperOrderForm";
import type { MarketOptionContract, MarketOptionsChain } from "@/lib/data/market-data-types";

function fmt(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

interface StrikeRow {
  strike: number;
  call?: MarketOptionContract;
  put?: MarketOptionContract;
}

function buildStrikeRows(chain: MarketOptionsChain): StrikeRow[] {
  const map = new Map<number, StrikeRow>();
  for (const c of chain.calls) {
    map.set(c.strikePrice, { ...(map.get(c.strikePrice) ?? { strike: c.strikePrice }), call: c });
  }
  for (const p of chain.puts) {
    map.set(p.strikePrice, { ...(map.get(p.strikePrice) ?? { strike: p.strikePrice }), put: p });
  }
  return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
}

/**
 * The real "order chain" for options paper trading — a strike ladder of
 * actual tradeable contracts (real bid/ask/OI/volume/IV/delta via Tradier),
 * not the underlying's price chart (which can't identify a specific
 * contract). Clicking Trade on a row opens the same shared PaperOrderForm
 * used everywhere else, locked to a market order on that exact contract.
 */
export function OptionsChainTradeTab() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ticker, setTicker] = useState("AAPL");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expiration, setExpiration] = useState<string>("");
  const [chain, setChain] = useState<MarketOptionsChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ right: "call" | "put"; contract: MarketOptionContract } | null>(null);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  async function loadExpirations(t: string) {
    setLoading(true);
    setError(null);
    setChain(null);
    setSelected(null);
    try {
      const res = await fetch(`/api/option-expirations?ticker=${encodeURIComponent(t)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load expirations.");
      const list: string[] = data.expirations ?? [];
      setExpirations(list);
      if (list.length > 0) {
        setExpiration(list[0]);
        await loadChain(t, list[0]);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  async function loadChain(t: string, exp: string) {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const res = await fetch(`/api/option-chain-contracts?ticker=${encodeURIComponent(t)}&expiration=${encodeURIComponent(exp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load option chain.");
      setChain(data as MarketOptionsChain);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const rows = chain ? buildStrikeRows(chain) : [];

  const prefillOption: PrefillOption | null = selected
    ? {
        underlyingSymbol: ticker.trim().toUpperCase(),
        expirationDate: expiration,
        optionRight: selected.right,
        strikePrice: selected.contract.strikePrice,
        referenceBid: selected.contract.bid,
        referenceAsk: selected.contract.ask,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real per-contract bid/ask/OI/volume/IV/delta from this app&apos;s options-chain provider — pick a contract to
        paper-trade it. Options are market-order-only (no historical intraday bar feed exists for individual
        contracts to evaluate a resting limit/stop order against), and selling to open is only allowed when fully
        collateralized (a covered call, or a cash-secured put) — this simulator has no margin model.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadExpirations(ticker.trim().toUpperCase());
        }}
        className="flex gap-3 items-end"
      >
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="px-3 py-2 text-sm"
          style={{ background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)", fontFamily: "var(--font-mono)" }}
        />
        {expirations.length > 0 && (
          <select
            value={expiration}
            onChange={(e) => {
              setExpiration(e.target.value);
              loadChain(ticker.trim().toUpperCase(), e.target.value);
            }}
            className="px-3 py-2 text-sm"
            style={{ background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)" }}
          >
            {expirations.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--signal)", color: "var(--ink-950)" }}>
          {loading ? "Loading…" : "Load Chain"}
        </button>
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                {["Call Bid", "Call Ask", "Call OI", "Call Vol", "Call Δ", "", "Strike", "", "Put Δ", "Put Vol", "Put OI", "Put Ask", "Put Bid"].map((h, i) => (
                  <th key={`${h}-${i}`} className="text-center py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.strike} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td className="text-center py-2 px-2">{fmt(row.call?.bid)}</td>
                  <td className="text-center py-2 px-2">{fmt(row.call?.ask)}</td>
                  <td className="text-center py-2 px-2">{row.call?.openInterest ?? "—"}</td>
                  <td className="text-center py-2 px-2">{row.call?.totalVolume ?? "—"}</td>
                  <td className="text-center py-2 px-2">{fmt(row.call?.delta, 3)}</td>
                  <td className="text-center py-2 px-2">
                    {row.call && (
                      <button
                        onClick={() => setSelected({ right: "call", contract: row.call! })}
                        className="text-xs px-2 py-1"
                        style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}
                      >
                        Trade
                      </button>
                    )}
                  </td>
                  <td className="text-center py-2 px-2 font-medium" style={{ fontFamily: "var(--font-mono)" }}>
                    {row.strike}
                  </td>
                  <td className="text-center py-2 px-2">
                    {row.put && (
                      <button
                        onClick={() => setSelected({ right: "put", contract: row.put! })}
                        className="text-xs px-2 py-1"
                        style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}
                      >
                        Trade
                      </button>
                    )}
                  </td>
                  <td className="text-center py-2 px-2">{fmt(row.put?.delta, 3)}</td>
                  <td className="text-center py-2 px-2">{row.put?.totalVolume ?? "—"}</td>
                  <td className="text-center py-2 px-2">{row.put?.openInterest ?? "—"}</td>
                  <td className="text-center py-2 px-2">{fmt(row.put?.ask)}</td>
                  <td className="text-center py-2 px-2">{fmt(row.put?.bid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {prefillOption && sessionId && (
        <section className="jv-card">
          <div className="jv-strip-title">
            Trade {ticker.trim().toUpperCase()} ${prefillOption.strikePrice} {prefillOption.optionRight === "call" ? "Call" : "Put"}
          </div>
          <PaperOrderForm sessionId={sessionId} prefillOption={prefillOption} compact onFilled={() => setSelected(null)} />
        </section>
      )}
    </div>
  );
}
