"use client";

import { useState } from "react";
import type { CheckStatus, RegimeCheck, RegimeLabel } from "@/lib/agents/trading-agent/skills/crypto-regime";
import type { CryptoRegimeResult, RegimeSourceStatus } from "@/lib/agents/trading-agent/skills/crypto-regime-service";
import { useTrackEvent } from "@/lib/analytics/use-track";

const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4";

const LABEL_COLOR: Record<RegimeLabel, string> = { breakout: "var(--signal)", mixed: "var(--verdict)", "range-bound": "var(--text-2)", undetermined: "var(--verdict)" };
const STATUS_TEXT: Record<CheckStatus, string> = { met: "Met", "not-met": "Not met", unavailable: "Unavailable" };
const STATUS_COLOR: Record<CheckStatus, string> = { met: "var(--signal)", "not-met": "var(--danger)", unavailable: "var(--verdict)" };

function readingText(c: RegimeCheck): string {
  if (c.reading === null) return "N/A";
  const r = c.reading;
  switch (c.unit) {
    case "pct":
    case "ratio-to-average":
      return `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`;
    case "share":
      return `${(r * 100).toFixed(1)}%`;
    case "musd":
      return `${r >= 0 ? "+" : "−"}$${Math.abs(r).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
    case "yield":
      return `${r.toFixed(2)}%`;
    case "index":
      return String(Math.round(r));
  }
}

function SourceRow({ s }: { s: RegimeSourceStatus }) {
  const color = s.status === "error" ? "var(--danger)" : "var(--text-2)";
  return (
    <tr style={{ borderBottom: "1px solid var(--ink-800)" }}>
      <td className={TD_CLASS} style={{ color: "var(--text-0)" }}>{s.label}</td>
      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{s.source}</td>
      <td className={`${TD_CLASS} font-mono text-xs`} style={{ color }}>{s.status === "ok" ? "read" : s.status === "typed-in" ? "typed in" : "not read"}</td>
      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{[s.asOf ? s.asOf.slice(0, 10) : null, s.detail].filter(Boolean).join(" · ")}</td>
    </tr>
  );
}

/** The score, the six conditions and where each reading came from. Presentational, so it can be rendered anywhere. */
export function CryptoRegimeView({ result }: { result: CryptoRegimeResult }) {
  const { regime } = result;
  return (
    <div className="flex flex-col gap-4">
      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="jv-label">Crypto regime</div>
            <div className="text-lg font-medium" style={{ color: LABEL_COLOR[regime.label] }}>{regime.verdict}</div>
          </div>
          <div className="flex items-center gap-1" role="img" aria-label={`${regime.met} of ${regime.total} conditions met`}>
            {regime.checks.map((c) => (
              <span
                key={c.key}
                title={`${c.label}: ${STATUS_TEXT[c.status]}`}
                style={{ width: 22, height: 10, borderRadius: 2, background: c.status === "met" ? "var(--signal)" : "transparent", border: `1px solid ${c.status === "unavailable" ? "var(--verdict)" : c.status === "met" ? "var(--signal)" : "var(--line-bright)"}`, borderStyle: c.status === "unavailable" ? "dashed" : "solid" }}
              />
            ))}
            <span className="font-mono text-sm ml-2" style={{ color: "var(--text-0)" }}>{regime.met} / {regime.total}</span>
          </div>
        </div>
        <div className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
          4 or more met is a breakout regime, 3 is mixed, 2 or fewer is range-bound. Read {result.asOf.slice(0, 16).replace("T", " ")} UTC.
        </div>
      </div>

      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                <th className={TH_CLASS}>Condition</th>
                <th className={TH_CLASS}>Now</th>
                <th className={TH_CLASS}>Needs</th>
                <th className={TH_CLASS}>Status</th>
              </tr>
            </thead>
            <tbody>
              {regime.checks.map((c) => (
                <tr key={c.key} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                  <td className={TD_CLASS} style={{ color: "var(--text-0)" }}>{c.label}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-0)" }}>{readingText(c)}</td>
                  <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{c.threshold}</td>
                  <td className={`${TD_CLASS} font-mono text-xs`} style={{ color: STATUS_COLOR[c.status] }}>{STATUS_TEXT[c.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="jv-card">
        <div className="jv-br-b" />
        <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>Where each reading came from</summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                <th className={TH_CLASS}>Input</th>
                <th className={TH_CLASS}>Source</th>
                <th className={TH_CLASS}>Status</th>
                <th className={TH_CLASS}>As of / note</th>
              </tr>
            </thead>
            <tbody>
              {result.sources.map((s) => (
                <SourceRow key={s.key} s={s} />
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {result.dataLimitations.map((d) => (
        <div key={d.slice(0, 40)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          {d}
        </div>
      ))}
    </div>
  );
}

/**
 * The six-condition crypto breakout checklist, read from free public data. A market-level research read, not advice;
 * it does not predict prices and has no crypto signals to gate yet.
 */
export function CryptoRegimeTab() {
  const [etf, setEtf] = useState("");
  const [result, setResult] = useState<CryptoRegimeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const qs = etf.trim() ? `?etfFlowsMtdMusd=${encodeURIComponent(etf.trim())}` : "";
      const res = await fetch(`/api/crypto-regime${qs}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Macro", metadata: { endpoint: "crypto-regime", status: res.status } });
      } else {
        setResult(json as CryptoRegimeResult);
        track("backtest_run", { tab: "Macro", metadata: { study: "crypto-regime" } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Six liquidity and trend conditions that have tended to come before a sustained crypto up-leg: stablecoin supply growth, US spot Bitcoin
        ETF flows, BTC dominance, BTC against its 200-day average, the 10-year Treasury yield and the Fear &amp; Greed index. Four or more met
        is a breakout regime; two or fewer is range-bound. It is a research read of market conditions, not a prediction and not advice.
      </p>

      <form onSubmit={run} className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          value={etf}
          onChange={(e) => setEtf(e.target.value)}
          placeholder="ETF net flows this month, $M (optional)"
          inputMode="decimal"
          className="jv-input w-72"
          aria-label="Net US spot Bitcoin ETF flows this month so far, in millions of dollars"
        />
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Reading…" : "Read the regime"}
        </button>
        <span className="text-xs" style={{ color: "var(--text-2)" }}>
          No free feed exists for ETF flows. Type the month-to-date total from farside.co.uk/btc, for example -386.3.
        </span>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {result && <CryptoRegimeView result={result} />}
    </div>
  );
}
