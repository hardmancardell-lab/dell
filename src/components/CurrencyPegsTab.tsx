"use client";

import { useEffect, useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type {
  CurrencyPeg,
  PegDeviationSnapshot,
  PegReversionDirectionResult,
  PegReversionResult,
} from "@/lib/agents/trading-agent/types";

const LOOKBACK_YEAR_OPTIONS = [1, 2, 3, 5];
const TRADE_LOG_DISPLAY_LIMIT = 30;

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}%` : "N/A";
}

function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}

function fmtRatio(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
}

function fmtDays(v: number | null): string {
  return v !== null ? `${v}d` : "N/A";
}

function DirectionResultPanel({
  title,
  thesis,
  result,
}: {
  title: string;
  thesis: string;
  result: PegReversionDirectionResult;
}) {
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>{title}</h3>
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        {thesis} — {result.signalOccurrences} historical occurrence(s) found.
      </p>

      {result.signalOccurrences === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>No occurrences of this signal in the selected lookback window.</p>
      ) : (
        <>
          <div className="overflow-x-auto mb-3">
            <table className="jv-table">
              <thead>
                <tr>
                  <th>Horizon</th>
                  <th>N</th>
                  <th>Mean Return</th>
                  <th><GlossaryTerm term="fdrAdjustedP">FDR-adjusted p</GlossaryTerm></th>
                  <th><GlossaryTerm term="bootstrapCi">Bootstrap 95% CI</GlossaryTerm></th>
                  <th><GlossaryTerm term="passesAllThreeBars">Passes All 3 Bars</GlossaryTerm></th>
                  <th><GlossaryTerm term="winRate">Win Rate</GlossaryTerm></th>
                  <th><GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm></th>
                </tr>
              </thead>
              <tbody>
                {result.horizons.map((h) => (
                  <tr key={h.horizonDays}>
                    <td className="font-medium">{h.horizonDays}d</td>
                    <td className="jv-num">{h.sampleSize}</td>
                    <td className="jv-num">{fmtPct(h.meanForwardReturnPct)}</td>
                    <td className="jv-num">{fmtP(h.pValueFdrAdjusted)}</td>
                    <td className="jv-num">
                      {h.bootstrapCiLower !== null && h.bootstrapCiUpper !== null
                        ? `[${h.bootstrapCiLower.toFixed(2)}, ${h.bootstrapCiUpper.toFixed(2)}]`
                        : "N/A"}
                    </td>
                    <td>
                      <span className={`jv-badge ${h.passesAllThreeBars ? "c-signal" : "c-neutral"}`}>
                        {h.passesAllThreeBars ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="jv-num">{h.winRate !== null ? `${h.winRate.toFixed(1)}%` : "N/A"}</td>
                    <td className="jv-num">{fmtRatio(h.profitFactor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.reversionStats && (
            <div className="mb-3 text-xs" style={{ color: "var(--text-2)" }}>
              Of {result.reversionStats.occurrencesTracked} occurrence(s), {result.reversionStats.occurrencesReverted}{" "}
              reverted back to the peg target within {result.reversionStats.maxTrackingDays} trading days (mean{" "}
              {fmtDays(
                result.reversionStats.meanDaysToRevert !== null ? Math.round(result.reversionStats.meanDaysToRevert) : null
              )}
              ); {result.reversionStats.occurrencesNeverReverted} did not.
            </div>
          )}

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-xs font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({result.tradeLog.length} occurrences)
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="jv-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entry</th>
                    <th>Deviation</th>
                    <th>Returns by Horizon</th>
                    <th>Win/Loss</th>
                    <th>Days to Revert</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row) => (
                    <tr key={row.dateKey}>
                      <td className="font-medium">{row.dateKey}</td>
                      <td className="jv-num">{row.entryClose.toFixed(4)}</td>
                      <td className="jv-num">{fmtPct(row.deviationPctAtEntry)}</td>
                      <td className="jv-num">
                        {row.returnsByHorizon.map((r) => `${r.horizonDays}d: ${fmtPct(r.returnPct)}`).join(" · ")}
                      </td>
                      <td>
                        {row.isWin === null ? (
                          "N/A"
                        ) : (
                          <span className={`jv-badge ${row.isWin ? "c-signal" : "c-danger"}`}>
                            {row.isWin ? "win" : "loss"}
                          </span>
                        )}
                      </td>
                      <td className="jv-num">{fmtDays(row.daysToRevert)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {result.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export function CurrencyPegsTab() {
  const [pegs, setPegs] = useState<CurrencyPeg[] | null>(null);
  const [snapshots, setSnapshots] = useState<PegDeviationSnapshot[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [selectedPair, setSelectedPair] = useState("USD/HKD");
  const [lookbackYears, setLookbackYears] = useState(3);
  const [result, setResult] = useState<PegReversionResult | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  useEffect(() => {
    fetch("/api/currency-pegs")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) setRegistryError(json.error ?? "Unknown error");
        else {
          setPegs(json.pegs as CurrencyPeg[]);
          setSnapshots(json.snapshots as PegDeviationSnapshot[]);
        }
      })
      .catch((err) => setRegistryError(err instanceof Error ? err.message : "Unknown error"));
  }, []);

  const liveDataPegs = pegs?.filter((p) => p.liveDataAvailable) ?? [];

  async function runBacktest() {
    setLoading(true);
    setBacktestError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/peg-reversion-backtest?pair=${encodeURIComponent(selectedPair)}&lookbackYears=${lookbackYears}`
      );
      const json = await res.json();
      if (!res.ok) {
        setBacktestError(json.error ?? "Unknown error");
        track("api_error", { tab: "Currency Pegs", symbol: selectedPair, metadata: { endpoint: "peg-reversion-backtest", status: res.status } });
      } else {
        const r = json as PegReversionResult;
        setResult(r);
        const passesAllThreeBars =
          (r.aboveTarget?.horizons?.some((h) => h.passesAllThreeBars) ?? false) ||
          (r.belowTarget?.horizons?.some((h) => h.passesAllThreeBars) ?? false);
        track("peg_backtest_run", {
          tab: "Currency Pegs",
          symbol: selectedPair,
          metadata: { lookbackYears, passesAllThreeBars },
        });
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Currency Pegs", symbol: selectedPair, metadata: { endpoint: "peg-reversion-backtest", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Every currency this app has confirmed is pegged to another, with its real target rate (and
        official band, where one exists). Every entry was re-checked against live sources on
        2026-08-07 (the &quot;Verified&quot; column below) — none have changed rate or regime. Below that:
        its own strategy — deviation from the peg target measured through the same statistical rigor
        (BH-FDR, bootstrap CI, out-of-sample split) every other backtest engine in this app uses, run
        against the target rate itself rather than a rolling statistical mean.
      </p>

      {registryError && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{registryError}</div>
        </div>
      )}

      {pegs && (
        <div className="overflow-x-auto mb-8">
          <table className="jv-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Target Rate</th>
                <th>Official Band</th>
                <th>Regime</th>
                <th>Authority</th>
                <th>Verified</th>
                <th>Live Rate</th>
                <th>Deviation</th>
              </tr>
            </thead>
            <tbody>
              {pegs.map((p) => {
                const snap = snapshots.find((s) => s.pair === p.pair);
                return (
                  <tr key={p.pair}>
                    <td className="font-medium">{p.pair}</td>
                    <td className="jv-num">{p.targetRate}</td>
                    <td className="jv-num">
                      {p.bandLowerBound !== null && p.bandUpperBound !== null
                        ? `${p.bandLowerBound}–${p.bandUpperBound}`
                        : "None (hard fixed)"}
                    </td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>{p.regimeName}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>{p.authority}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>{p.verifiedAsOf}</td>
                    <td className="jv-num">
                      {!p.liveDataAvailable ? (
                        <span className="text-xs" style={{ color: "var(--text-2)" }}>No live feed</span>
                      ) : snap ? (
                        snap.currentRate.toFixed(4)
                      ) : (
                        "…"
                      )}
                    </td>
                    <td className="jv-num">
                      {snap ? (
                        <span style={{ color: snap.outsideBand ? "var(--danger)" : "var(--text-1)", fontWeight: snap.outsideBand ? 500 : 400 }}>
                          {fmtPct(snap.deviationPct)}
                          {snap.outsideBand ? " (outside band)" : ""}
                        </span>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
            &quot;No live feed&quot; pegs are real, currently-in-force pegs — this app just has no live
            spot-price source for them (confirmed by direct testing against OANDA, this app&apos;s only
            forex data provider).
          </p>
        </div>
      )}

      <div className="jv-card mb-4">
        <div className="jv-br-b" />
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-0)" }}>Peg-Deviation Mean Reversion — Backtest</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="jv-label block mb-1">Pair</label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="jv-select"
            >
              {liveDataPegs.map((p) => (
                <option key={p.pair} value={p.pair}>
                  {p.pair}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="jv-label block mb-1">Lookback</label>
            <select
              value={lookbackYears}
              onChange={(e) => setLookbackYears(Number(e.target.value))}
              className="jv-select"
            >
              {LOOKBACK_YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y} year{y > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={runBacktest}
            disabled={loading || liveDataPegs.length === 0}
            className="jv-btn"
          >
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
          Only pairs with a confirmed live price-history feed are selectable here (currently USD/HKD and
          EUR/DKK) — the rest of the registry above is real reference data, not a runnable strategy in
          this app.
        </p>
      </div>

      {backtestError && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{backtestError}</div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {result.pair} — {result.tradingDaysScanned} trading days scanned over {result.lookbackYears} year(s).
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <DirectionResultPanel
            title="Above Target — Reversion Down Expected"
            thesis="Price trades above the peg target/band; the peg thesis is that authorities defend the peg, pulling price back down"
            result={result.aboveTarget}
          />
          <DirectionResultPanel
            title="Below Target — Reversion Up Expected"
            thesis="Price trades below the peg target/band; the peg thesis is that authorities defend the peg, pulling price back up"
            result={result.belowTarget}
          />
        </div>
      )}
    </div>
  );
}
