"use client";

import { useEffect, useState } from "react";

interface Result {
  fredSeriesId: string;
  fredSeriesLabel: string;
  etfTicker: string;
  targetYieldPct: number;
  currentYieldPct: number;
  currentYieldDate: string;
  currentEtfPrice: number;
  targetEtfPrice: number;
  alertDirection: "above" | "below";
  regressionSlope: number;
  regressionRSquared: number;
  sampleSize: number;
  lookbackYears: number;
  dataLimitations: string[];
  error?: string;
}

const SERIES_OPTIONS = [
  { value: "DGS10", label: "10-Year Treasury", defaultEtf: "IEF" },
  { value: "DGS2", label: "2-Year Treasury", defaultEtf: "SHY" },
  { value: "DGS30", label: "30-Year Treasury", defaultEtf: "TLT" },
  { value: "DGS5", label: "5-Year Treasury", defaultEtf: "IEF" },
];

export function YieldAlertThresholdTab() {
  const [fredSeriesId, setFredSeriesId] = useState("DGS10");
  const [etfTicker, setEtfTicker] = useState("IEF");
  const [targetYieldPct, setTargetYieldPct] = useState(5.25);
  const [lookbackYears, setLookbackYears] = useState(2);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = `/api/yield-etf-price-threshold?fredSeriesId=${fredSeriesId}&etfTicker=${encodeURIComponent(etfTicker)}&targetYieldPct=${targetYieldPct}&lookbackYears=${lookbackYears}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Unknown error");
        setResult(null);
      } else {
        setResult(json as Result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        No real intraday Treasury yield data exists anywhere this app can source for free — FRED, the only yield
        provider here, is daily-close only. This converts a yield threshold into the equivalent price on a real,
        intraday-tradable Treasury ETF, fit from real historical data, so you can set an actual intraday alert on
        the Alerts tab (Price Threshold condition) using that ETF and price instead.
      </p>

      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="jv-label block mb-1">Treasury tenor</label>
          <select
            value={fredSeriesId}
            onChange={(e) => {
              const opt = SERIES_OPTIONS.find((o) => o.value === e.target.value);
              setFredSeriesId(e.target.value);
              if (opt) setEtfTicker(opt.defaultEtf);
            }}
            className="jv-select"
          >
            {SERIES_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="jv-label block mb-1">ETF proxy</label>
          <input value={etfTicker} onChange={(e) => setEtfTicker(e.target.value.toUpperCase())} className="jv-input" style={{ width: 90 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Target yield %</label>
          <input type="number" step="0.01" value={targetYieldPct} onChange={(e) => setTargetYieldPct(Number(e.target.value))} className="jv-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Lookback years</label>
          <input type="number" value={lookbackYears} onChange={(e) => setLookbackYears(Number(e.target.value))} className="jv-input" style={{ width: 90 }} />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Computing…" : "Compute"}
        </button>
      </form>

      {error && <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
            <div className="jv-label mb-2">Set this alert on the Alerts tab</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
              <div>
                <div className="jv-label">Ticker</div>
                <div className="font-mono text-lg" style={{ color: "var(--text-0)" }}>{result.etfTicker}</div>
              </div>
              <div>
                <div className="jv-label">Asset Class</div>
                <div className="font-mono text-lg" style={{ color: "var(--text-0)" }}>Bond</div>
              </div>
              <div>
                <div className="jv-label">Condition</div>
                <div className="font-mono text-lg" style={{ color: "var(--text-0)" }}>Price Threshold</div>
              </div>
              <div>
                <div className="jv-label">Direction</div>
                <div className="font-mono text-lg capitalize" style={{ color: "var(--verdict)" }}>{result.alertDirection}</div>
              </div>
            </div>
            <div className="font-mono text-2xl" style={{ color: "var(--verdict)" }}>
              Target price: ${result.targetEtfPrice.toFixed(2)}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
              Represents ~{result.targetYieldPct.toFixed(2)}% on {result.fredSeriesLabel}, based on {result.etfTicker}&apos;s real historical relationship to {result.fredSeriesId}.
            </div>
          </div>

          <div className="jv-card grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="jv-br-b" />
            <div>
              <div className="jv-label">Current {result.fredSeriesLabel}</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.currentYieldPct.toFixed(2)}%</div>
              <div className="text-xs" style={{ color: "var(--text-2)" }}>as of {result.currentYieldDate}</div>
            </div>
            <div>
              <div className="jv-label">Current {result.etfTicker} Price</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>${result.currentEtfPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="jv-label">Fit Quality (R²)</div>
              <div className="font-mono" style={{ color: "var(--text-1)" }}>{result.regressionRSquared.toFixed(3)}</div>
            </div>
            <div>
              <div className="jv-label">Sample Size</div>
              <div className="font-mono" style={{ color: "var(--text-1)" }}>{result.sampleSize} real days</div>
            </div>
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
