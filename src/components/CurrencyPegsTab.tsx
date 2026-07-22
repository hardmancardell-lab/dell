"use client";

import { useEffect, useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
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
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-zinc-500 mb-3">
        {thesis} — {result.signalOccurrences} historical occurrence(s) found.
      </p>

      {result.signalOccurrences === 0 ? (
        <p className="text-sm text-zinc-500">No occurrences of this signal in the selected lookback window.</p>
      ) : (
        <>
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4">Horizon</th>
                  <th className="py-2 pr-4">N</th>
                  <th className="py-2 pr-4">Mean Return</th>
                  <th className="py-2 pr-4"><GlossaryTerm term="fdrAdjustedP">FDR-adjusted p</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="bootstrapCi">Bootstrap 95% CI</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="passesAllThreeBars">Passes All 3 Bars</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="winRate">Win Rate</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm></th>
                </tr>
              </thead>
              <tbody>
                {result.horizons.map((h) => (
                  <tr key={h.horizonDays} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium">{h.horizonDays}d</td>
                    <td className="py-2 pr-4 text-zinc-500">{h.sampleSize}</td>
                    <td className="py-2 pr-4">{fmtPct(h.meanForwardReturnPct)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtP(h.pValueFdrAdjusted)}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {h.bootstrapCiLower !== null && h.bootstrapCiUpper !== null
                        ? `[${h.bootstrapCiLower.toFixed(2)}, ${h.bootstrapCiUpper.toFixed(2)}]`
                        : "N/A"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          h.passesAllThreeBars
                            ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {h.passesAllThreeBars ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">{h.winRate !== null ? `${h.winRate.toFixed(1)}%` : "N/A"}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtRatio(h.profitFactor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.reversionStats && (
            <div className="mb-3 text-xs text-zinc-500">
              Of {result.reversionStats.occurrencesTracked} occurrence(s), {result.reversionStats.occurrencesReverted}{" "}
              reverted back to the peg target within {result.reversionStats.maxTrackingDays} trading days (mean{" "}
              {fmtDays(
                result.reversionStats.meanDaysToRevert !== null ? Math.round(result.reversionStats.meanDaysToRevert) : null
              )}
              ); {result.reversionStats.occurrencesNeverReverted} did not.
            </div>
          )}

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
            <summary className="text-xs font-medium cursor-pointer">
              Trade Log ({result.tradeLog.length} occurrences)
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3">Deviation</th>
                    <th className="py-1.5 pr-3">Returns by Horizon</th>
                    <th className="py-1.5 pr-3">Win/Loss</th>
                    <th className="py-1.5 pr-3">Days to Revert</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row) => (
                    <tr key={row.dateKey} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-1.5 pr-3 font-medium">{row.dateKey}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">{row.entryClose.toFixed(4)}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">{fmtPct(row.deviationPctAtEntry)}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">
                        {row.returnsByHorizon.map((r) => `${r.horizonDays}d: ${fmtPct(r.returnPct)}`).join(" · ")}
                      </td>
                      <td className="py-1.5 pr-3">
                        {row.isWin === null ? (
                          "N/A"
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              row.isWin
                                ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                                : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                            }`}
                          >
                            {row.isWin ? "win" : "loss"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-500">{fmtDays(row.daysToRevert)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs text-zinc-400 mt-2">
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
      } else {
        setResult(json as PegReversionResult);
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Every currency this app has confirmed is pegged to another, with its real target rate (and
        official band, where one exists). Below that: its own strategy — deviation from the peg
        target measured through the same statistical rigor (BH-FDR, bootstrap CI, out-of-sample
        split) every other backtest engine in this app uses, run against the target rate itself
        rather than a rolling statistical mean.
      </p>

      {registryError && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {registryError}
        </div>
      )}

      {pegs && (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4">Pair</th>
                <th className="py-2 pr-4">Target Rate</th>
                <th className="py-2 pr-4">Official Band</th>
                <th className="py-2 pr-4">Regime</th>
                <th className="py-2 pr-4">Authority</th>
                <th className="py-2 pr-4">Live Rate</th>
                <th className="py-2 pr-4">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {pegs.map((p) => {
                const snap = snapshots.find((s) => s.pair === p.pair);
                return (
                  <tr key={p.pair} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium">{p.pair}</td>
                    <td className="py-2 pr-4 text-zinc-500">{p.targetRate}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {p.bandLowerBound !== null && p.bandUpperBound !== null
                        ? `${p.bandLowerBound}–${p.bandUpperBound}`
                        : "None (hard fixed)"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500 text-xs">{p.regimeName}</td>
                    <td className="py-2 pr-4 text-zinc-500 text-xs">{p.authority}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {!p.liveDataAvailable ? (
                        <span className="text-xs text-zinc-400">No live feed</span>
                      ) : snap ? (
                        snap.currentRate.toFixed(4)
                      ) : (
                        "…"
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {snap ? (
                        <span
                          className={
                            snap.outsideBand
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : "text-zinc-500"
                          }
                        >
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
          <p className="text-xs text-zinc-400 mt-2">
            &quot;No live feed&quot; pegs are real, currently-in-force pegs — this app just has no live
            spot-price source for them (confirmed by direct testing against OANDA, this app&apos;s only
            forex data provider).
          </p>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">Peg-Deviation Mean Reversion — Backtest</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Pair</label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              {liveDataPegs.map((p) => (
                <option key={p.pair} value={p.pair}>
                  {p.pair}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Lookback</label>
            <select
              value={lookbackYears}
              onChange={(e) => setLookbackYears(Number(e.target.value))}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
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
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-2">
          Only pairs with a confirmed live price-history feed are selectable here (currently USD/HKD and
          EUR/DKK) — the rest of the registry above is real reference data, not a runnable strategy in
          this app.
        </p>
      </div>

      {backtestError && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {backtestError}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {result.pair} — {result.tradingDaysScanned} trading days scanned over {result.lookbackYears} year(s).
          </div>

          {result.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
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
