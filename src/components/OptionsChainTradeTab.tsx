"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import { PaperOrderForm, type PrefillOption } from "./PaperOrderForm";
import { mapStrategyToLegs, type StrategyLegPrefill } from "@/lib/agents/trading-agent/skills/strategy-order-mapper";
import { summarizeStrategyPayoff, type PayoffLeg } from "@/lib/agents/trading-agent/skills/option-payoff";
import type { MarketOptionContract, MarketOptionsChain } from "@/lib/data/market-data-types";

const STRATEGY_NAMES = [
  "Covered Call",
  "Cash-Secured Put",
  "Bull Call Spread",
  "Protective Put / Bear Put Spread",
  "Long Straddle / Strangle",
  "Iron Condor",
];

function fmt(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

interface StrikeRow {
  strike: number;
  call?: MarketOptionContract;
  put?: MarketOptionContract;
}

interface ChainWithSpot extends MarketOptionsChain {
  underlyingPrice: number;
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

/** The strike closest to the real spot price — the ATM divider row. */
function findAtmStrike(rows: StrikeRow[], spot: number): number | null {
  if (rows.length === 0) return null;
  let closest = rows[0].strike;
  let bestDiff = Math.abs(rows[0].strike - spot);
  for (const row of rows) {
    const diff = Math.abs(row.strike - spot);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = row.strike;
    }
  }
  return closest;
}

/**
 * The real "order chain" for options paper trading — a strike ladder of
 * actual tradeable contracts (real bid/ask/OI/volume/IV/delta via Tradier),
 * not the underlying's price chart (which can't identify a specific
 * contract). ITM strikes are shaded and the strike nearest the real spot
 * price is marked, matching how a real options chain (Webull, etc.) reads.
 * Clicking Trade on a row populates the docked ticket panel, which opens
 * the same shared PaperOrderForm used everywhere else, locked to a market
 * order on that exact contract.
 */
export function OptionsChainTradeTab({ initialTicker }: { initialTicker?: string } = {}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ticker, setTicker] = useState(initialTicker ?? "AAPL");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expiration, setExpiration] = useState<string>("");
  const [chain, setChain] = useState<ChainWithSpot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ right: "call" | "put"; contract: MarketOptionContract } | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [strategyQuantity, setStrategyQuantity] = useState("1");
  const [placingAll, setPlacingAll] = useState(false);
  const [placeAllError, setPlaceAllError] = useState<string | null>(null);
  const [placeAllMsg, setPlaceAllMsg] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  // Auto-load when embedded with a prefilled ticker (e.g. the chart's
  // floating "Options Chain" panel) so it shows real data immediately
  // instead of requiring an extra click — the plain, unprefilled call site
  // (the standalone "Trade Options" tab) is unaffected.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialTicker) loadExpirations(initialTicker.trim().toUpperCase());
  }, [initialTicker]);

  async function placeAllLegs(legs: StrategyLegPrefill[], underlyingSymbol: string, expirationDate: string) {
    if (!sessionId) return;
    setPlacingAll(true);
    setPlaceAllError(null);
    setPlaceAllMsg(null);
    const strategyGroupId = crypto.randomUUID();
    const qty = Number(strategyQuantity) || 1;
    try {
      for (const leg of legs) {
        const res = await fetch("/api/paper-trading/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            order: {
              symbol: underlyingSymbol,
              assetClass: "option",
              side: leg.side,
              orderType: "market",
              quantity: qty,
              underlyingSymbol,
              expirationDate,
              optionRight: leg.right,
              strikePrice: leg.strike,
              strategyGroupId,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${leg.side} ${leg.right} $${leg.strike}: ${data.error ?? "failed"}`);
      }
      setPlaceAllMsg(`Placed all ${legs.length} leg(s) — tagged as one strategy in the ledger.`);
      setSelectedStrategy("");
    } catch (err) {
      setPlaceAllError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPlacingAll(false);
    }
  }

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
      setChain(data as ChainWithSpot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const rows = chain ? buildStrikeRows(chain) : [];
  const spot = chain?.underlyingPrice ?? null;
  const atmStrike = spot !== null ? findAtmStrike(rows, spot) : null;

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
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real per-contract bid/ask/OI/volume/IV/delta from this app&apos;s options-chain provider. In-the-money strikes
        are shaded; the row nearest the real current price is marked. Options are market-order-only (no historical
        intraday bar feed exists for individual contracts to evaluate a resting limit/stop order against), and
        selling to open is only allowed when fully collateralized (a covered call, or a cash-secured put) — this
        simulator has no margin model.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadExpirations(ticker.trim().toUpperCase());
        }}
        className="flex gap-3 items-end"
      >
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input" />
        {expirations.length > 0 && (
          <select
            value={expiration}
            onChange={(e) => {
              setExpiration(e.target.value);
              loadChain(ticker.trim().toUpperCase(), e.target.value);
            }}
            className="jv-select"
          >
            {expirations.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Loading…" : "Load Chain"}
        </button>
        {spot !== null && (
          <span className="jv-badge c-neutral">
            {ticker.trim().toUpperCase()} {spot.toFixed(2)}
          </span>
        )}
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="overflow-x-auto">
            <table className="jv-table">
              <thead>
                <tr>
                  {["Call Bid", "Call Ask", "Call OI", "Call Vol", "Call Δ", "", "Strike", "", "Put Δ", "Put Vol", "Put OI", "Put Ask", "Put Bid"].map((h, i) => (
                    <th key={`${h}-${i}`} className="text-center">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const callItm = spot !== null && row.strike < spot;
                  const putItm = spot !== null && row.strike > spot;
                  const isAtm = row.strike === atmStrike;
                  return (
                    <tr key={row.strike} className={isAtm ? "jv-chain-atm" : undefined}>
                      <td className={`text-center jv-num ${callItm ? "jv-chain-itm" : ""}`}>{fmt(row.call?.bid)}</td>
                      <td className={`text-center jv-num ${callItm ? "jv-chain-itm" : ""}`}>{fmt(row.call?.ask)}</td>
                      <td className={`text-center jv-num ${callItm ? "jv-chain-itm" : ""}`}>{row.call?.openInterest ?? "—"}</td>
                      <td className={`text-center jv-num ${callItm ? "jv-chain-itm" : ""}`}>{row.call?.totalVolume ?? "—"}</td>
                      <td className={`text-center jv-num ${callItm ? "jv-chain-itm" : ""}`}>{fmt(row.call?.delta, 3)}</td>
                      <td className={`text-center ${callItm ? "jv-chain-itm" : ""}`}>
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
                      <td className="text-center jv-num font-medium" style={{ color: "var(--text-0)" }}>
                        {row.strike}
                      </td>
                      <td className={`text-center ${putItm ? "jv-chain-itm" : ""}`}>
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
                      <td className={`text-center jv-num ${putItm ? "jv-chain-itm" : ""}`}>{fmt(row.put?.delta, 3)}</td>
                      <td className={`text-center jv-num ${putItm ? "jv-chain-itm" : ""}`}>{row.put?.totalVolume ?? "—"}</td>
                      <td className={`text-center jv-num ${putItm ? "jv-chain-itm" : ""}`}>{row.put?.openInterest ?? "—"}</td>
                      <td className={`text-center jv-num ${putItm ? "jv-chain-itm" : ""}`}>{fmt(row.put?.ask)}</td>
                      <td className={`text-center jv-num ${putItm ? "jv-chain-itm" : ""}`}>{fmt(row.put?.bid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="jv-ticket-dock">
            <section className="jv-card">
              {prefillOption && sessionId ? (
                <>
                  <div className="jv-strip-title">
                    Trade {ticker.trim().toUpperCase()} ${prefillOption.strikePrice} {prefillOption.optionRight === "call" ? "Call" : "Put"}
                  </div>
                  <PaperOrderForm sessionId={sessionId} prefillOption={prefillOption} compact onFilled={() => setSelected(null)} />
                </>
              ) : (
                <>
                  <div className="jv-strip-title">Order Ticket</div>
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>
                    Select a contract from the chain to trade it.
                  </p>
                </>
              )}
            </section>

            {spot !== null && chain && (
              <section className="jv-card mt-4">
                <div className="jv-strip-title">Strategy Builder</div>
                <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                  Real strikes from the live chain above, mapped by a documented rule-based heuristic — the same
                  shapes the Options Dashboard&apos;s Strategy Scanner may suggest from GEX/skew. Not investment
                  advice.
                </p>
                <select
                  value={selectedStrategy}
                  onChange={(e) => {
                    setSelectedStrategy(e.target.value);
                    setPlaceAllMsg(null);
                    setPlaceAllError(null);
                  }}
                  className="jv-select w-full mb-2"
                >
                  <option value="">Select a strategy…</option>
                  {STRATEGY_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                {selectedStrategy &&
                  (() => {
                    const legs = mapStrategyToLegs(selectedStrategy, spot, chain, expiration);
                    if (!legs) {
                      return (
                        <p className="text-sm" style={{ color: "var(--danger)" }}>
                          Couldn&apos;t map real strikes for this strategy from the current chain (not enough OTM
                          strikes on one or both sides).
                        </p>
                      );
                    }
                    const payoffLegs: PayoffLeg[] = legs.map((leg) => ({
                      right: leg.right,
                      side: leg.side,
                      strike: leg.strike,
                      premium: leg.side === "buy" ? leg.contract.ask : leg.contract.bid,
                      contracts: Number(strategyQuantity) || 1,
                    }));
                    const summary = summarizeStrategyPayoff(payoffLegs, spot);
                    return (
                      <div className="flex flex-col gap-3">
                        <ul className="text-sm" style={{ color: "var(--text-1)" }}>
                          {legs.map((leg) => (
                            <li key={`${leg.right}-${leg.strike}-${leg.side}`}>
                              {leg.side === "buy" ? "Buy" : "Sell"} {leg.right} ${leg.strike} @{" "}
                              {leg.side === "buy" ? leg.contract.ask.toFixed(2) : leg.contract.bid.toFixed(2)}
                            </li>
                          ))}
                        </ul>

                        <div style={{ width: "100%", height: 140 }}>
                          <LineChart width={280} height={140} data={summary.points} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
                            <XAxis
                              dataKey="underlyingPrice"
                              tick={{ fontSize: 10, fill: "var(--text-2)" }}
                              tickFormatter={(v: number) => v.toFixed(0)}
                            />
                            <YAxis tick={{ fontSize: 10, fill: "var(--text-2)" }} width={40} />
                            <ReferenceLine y={0} stroke="var(--line-bright)" />
                            <ReferenceLine x={spot} stroke="var(--verdict)" strokeDasharray="3 3" />
                            <Tooltip
                              formatter={(v) => `$${Number(v).toFixed(2)}`}
                              labelFormatter={(v) => `Underlying $${Number(v).toFixed(2)}`}
                              contentStyle={{ background: "var(--ink-900)", border: "1px solid var(--line)", fontSize: 12 }}
                            />
                            <Line type="monotone" dataKey="pnl" stroke="var(--signal)" dot={false} strokeWidth={2} />
                          </LineChart>
                        </div>

                        <div className="text-xs grid grid-cols-3 gap-2" style={{ color: "var(--text-1)" }}>
                          <div>
                            <div style={{ color: "var(--text-2)" }}>Max Profit</div>
                            <div>{summary.maxProfit === null ? "Unbounded" : `$${summary.maxProfit.toFixed(2)}`}</div>
                          </div>
                          <div>
                            <div style={{ color: "var(--text-2)" }}>Max Loss</div>
                            <div>{summary.maxLoss === null ? "Unbounded" : `$${summary.maxLoss.toFixed(2)}`}</div>
                          </div>
                          <div>
                            <div style={{ color: "var(--text-2)" }}>Breakeven</div>
                            <div>{summary.breakevens.length > 0 ? summary.breakevens.map((b) => `$${b.toFixed(2)}`).join(", ") : "N/A"}</div>
                          </div>
                        </div>

                        <div className="flex gap-2 items-center">
                          <input
                            value={strategyQuantity}
                            onChange={(e) => setStrategyQuantity(e.target.value)}
                            className="jv-input"
                            style={{ width: 70 }}
                            placeholder="Qty"
                          />
                          <button
                            onClick={() => placeAllLegs(legs, ticker.trim().toUpperCase(), expiration)}
                            disabled={placingAll || !sessionId}
                            className="jv-btn"
                          >
                            {placingAll ? "Placing…" : `Place All ${legs.length} Leg(s)`}
                          </button>
                        </div>
                        {placeAllError && <p className="text-sm" style={{ color: "var(--danger)" }}>{placeAllError}</p>}
                        {placeAllMsg && <p className="text-sm" style={{ color: "var(--signal)" }}>{placeAllMsg}</p>}
                      </div>
                    );
                  })()}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
