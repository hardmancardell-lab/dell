"use client";

import { useState } from "react";
import type { PaperOptionRight } from "@/lib/agents/trading-agent/types";

interface ScenarioRow {
  underlyingPricePct: number;
  underlyingPrice: number;
  theoreticalValue: number;
  profitPerContract: number;
  profitPct: number;
}

interface ScenarioResult {
  scenarioDate: string;
  daysToExpirationAtScenario: number;
  impliedVolatilityPct: number;
  riskFreeRatePct: number;
  breakevenUnderlyingPrice: number | null;
  entryDebit: number;
  spotPrice: number;
  rows: ScenarioRow[];
  dataLimitations: string[];
}

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/**
 * "Once the expiration is chosen, show what it'll be worth on that day" —
 * hits the real Black-Scholes scenario endpoint on demand (not
 * pre-fetched on every card render, since it needs a fresh chain quote)
 * for the exact suggested single-leg contract.
 */
export function OptionScenarioPanel({
  ticker,
  expirationDate,
  optionRight,
  longStrike,
  horizonDays,
}: {
  ticker: string;
  expirationDate: string;
  optionRight: PaperOptionRight;
  longStrike: number;
  horizonDays: number;
}) {
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  async function load() {
    setShown(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/option-scenario?ticker=${encodeURIComponent(ticker)}&expiration=${expirationDate}&right=${optionRight}&longStrike=${longStrike}&horizonDays=${horizonDays}`
      );
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as ScenarioResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (!shown) {
    return (
      <button onClick={load} className="text-xs underline mb-3" style={{ color: "var(--text-2)" }}>
        Show profit scenarios (real Black-Scholes, IV held constant)
      </button>
    );
  }

  return (
    <div className="jv-card mb-3" style={{ padding: 12 }}>
      {loading && <p className="text-xs" style={{ color: "var(--text-2)" }}>Pricing scenarios…</p>}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            Valued as of <strong>{result.scenarioDate}</strong> ({result.daysToExpirationAtScenario}d to expiration then),
            holding implied vol fixed at <strong>{result.impliedVolatilityPct.toFixed(1)}%</strong> — today&apos;s real level for
            this contract, not a change to it.
          </p>
          <p className="text-sm" style={{ color: "var(--text-1)" }}>
            Entry debit: <strong>{fmtUsd(result.entryDebit)}</strong>/share ({fmtUsd(result.entryDebit * 100)}/contract).{" "}
            {result.breakevenUnderlyingPrice !== null ? (
              <>
                Needs {ticker} at <strong>{fmtUsd(result.breakevenUnderlyingPrice)}</strong> by then just to break even
                (currently {fmtUsd(result.spotPrice)}).
              </>
            ) : (
              "No breakeven found in a plausible price range at this date — see the note below."
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className="py-1 pr-3 font-normal">If {ticker} is at</th>
                  <th className="py-1 pr-3 font-normal">Contract worth</th>
                  <th className="py-1 pr-3 font-normal">P&amp;L / contract</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {result.rows.map((r) => (
                  <tr key={r.underlyingPricePct} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className="py-1 pr-3" style={{ color: "var(--text-0)" }}>
                      {fmtUsd(r.underlyingPrice)} ({fmtPct(r.underlyingPricePct)})
                    </td>
                    <td className="py-1 pr-3" style={{ color: "var(--text-1)" }}>{fmtUsd(r.theoreticalValue)}</td>
                    <td className="py-1 pr-3 font-medium" style={{ color: r.profitPerContract >= 0 ? "var(--signal)" : "var(--danger)" }}>
                      {fmtUsd(r.profitPerContract)} ({fmtPct(r.profitPct)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="text-[11px]" style={{ color: "var(--verdict)" }}>{d}</div>
          ))}
        </div>
      )}
    </div>
  );
}
