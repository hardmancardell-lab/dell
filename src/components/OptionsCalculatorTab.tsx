"use client";

import { useEffect, useState } from "react";
import type { OptionsCalculatorResult, RiskFreeRateResult } from "@/lib/agents/trading-agent/types";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
      />
    </label>
  );
}

export function OptionsCalculatorTab() {
  const [spot, setSpot] = useState("100");
  const [strike, setStrike] = useState("100");
  const [dte, setDte] = useState("30");
  const [iv, setIv] = useState("30");
  const [riskFreeRate, setRiskFreeRate] = useState("5");
  const [riskFreeRateInfo, setRiskFreeRateInfo] = useState<RiskFreeRateResult | null>(null);
  const [riskFreeRateError, setRiskFreeRateError] = useState<string | null>(null);

  const [data, setData] = useState<OptionsCalculatorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Live 3-month Treasury yield as the starting value — not a hardcoded
  // guess. Still a plain editable field afterward; this only sets the default.
  useEffect(() => {
    fetch("/api/risk-free-rate")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setRiskFreeRateError(json.error ?? "Could not load the live risk-free rate.");
          return;
        }
        const info = json as RiskFreeRateResult;
        setRiskFreeRateInfo(info);
        setRiskFreeRate(String(info.ratePercent));
      })
      .catch((err) => {
        setRiskFreeRateError(err instanceof Error ? err.message : "Could not load the live risk-free rate.");
      });
  }, []);

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({ spot, strike, dte, iv, r: riskFreeRate });
      const res = await fetch(`/api/options-calculator?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setData(json as OptionsCalculatorResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Theoretical price and Greeks for a call and put at the same strike/expiration.
      </p>

      <form onSubmit={calculate} className="grid grid-cols-2 sm:grid-cols-5 gap-4 items-end">
        <Field label="Spot Price" value={spot} onChange={setSpot} />
        <Field label="Strike Price" value={strike} onChange={setStrike} />
        <Field label="Days to Expiration" value={dte} onChange={setDte} step="1" />
        <Field label="Implied Vol (%)" value={iv} onChange={setIv} />
        <Field label="Risk-Free Rate (%)" value={riskFreeRate} onChange={setRiskFreeRate} />
      </form>
      <p className="text-xs text-zinc-400 mt-2">
        {riskFreeRateInfo
          ? `Defaulted to the live 3-month Treasury yield (${riskFreeRateInfo.ratePercent}%, as of ${riskFreeRateInfo.asOfDate}, FRED series ${riskFreeRateInfo.seriesId}) — edit freely, it just won't re-fetch until you reload this tab.`
          : riskFreeRateError
            ? `Could not load the live risk-free rate (${riskFreeRateError}) — defaulted to 5%, edit manually.`
            : "Loading the live risk-free rate…"}
      </p>
      <button
        onClick={calculate}
        disabled={loading}
        className="mt-4 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Calculating…" : "Calculate"}
      </button>

      {error && (
        <div className="mt-8 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400">
          <div className="font-medium">Could not calculate</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {data && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
          <section>
            <h2 className="text-xl font-semibold mb-3">Call</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Theoretical Price" value={`$${data.call.price.toFixed(2)}`} />
              <StatCard label="Delta" value={data.call.greeks.delta.toFixed(3)} />
              <StatCard label="Gamma" value={data.call.greeks.gamma.toFixed(4)} />
              <StatCard label="Theta / day" value={`$${data.call.greeks.theta.toFixed(3)}`} />
              <StatCard label="Vega / 1% IV" value={`$${data.call.greeks.vega.toFixed(3)}`} />
            </div>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">Put</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Theoretical Price" value={`$${data.put.price.toFixed(2)}`} />
              <StatCard label="Delta" value={data.put.greeks.delta.toFixed(3)} />
              <StatCard label="Gamma" value={data.put.greeks.gamma.toFixed(4)} />
              <StatCard label="Theta / day" value={`$${data.put.greeks.theta.toFixed(3)}`} />
              <StatCard label="Vega / 1% IV" value={`$${data.put.greeks.vega.toFixed(3)}`} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
