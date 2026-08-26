"use client";

import { useEffect, useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import { PaperOrderForm } from "./PaperOrderForm";
import type { GuidedTradeSignal } from "@/lib/agents/trading-agent/types";

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtRangePct(lower: number | null, upper: number | null): string | null {
  if (lower === null || upper === null) return null;
  const f = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  return `${f(lower)} to ${f(upper)}`;
}

function GuidedCard({ signal }: { signal: GuidedTradeSignal }) {
  const [expanded, setExpanded] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const range = fmtRangePct(signal.bootstrapCiLower, signal.bootstrapCiUpper);
  const sessionId = typeof window !== "undefined" ? getOrCreateSessionId() : "";

  if (skipped) return null;

  return (
    <div className="jv-card">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-2)" }}>{signal.ticker}</div>
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{signal.headline}</h3>
        </div>
        <div className="text-right">
          <div className="text-xs" style={{ color: "var(--text-2)" }}>Current price</div>
          <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{fmtUsd(signal.currentPrice)}</div>
        </div>
      </div>

      <p className="text-sm mb-1" style={{ color: "var(--text-1)" }}>
        This exact setup happened <strong>{signal.sampleSize}</strong> times before in {signal.ticker}&apos;s real history.
        It worked out (a positive move) <strong>{signal.historicalWinRatePct.toFixed(0)}%</strong> of the time, holding for {signal.horizonLabel}.
      </p>
      {range && (
        <p className="text-sm mb-1" style={{ color: "var(--text-1)" }}>
          Typical range of outcomes: <strong>{range}</strong>.
        </p>
      )}
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        Exit: {signal.exitType === "time" ? "fixed holding period" : "price target/stop"} — {signal.exitRule}
      </p>

      {!expanded ? (
        <div className="flex gap-2">
          <button onClick={() => setExpanded(true)} className="jv-btn">
            Take it (Paper Trade)
          </button>
          <button onClick={() => setSkipped(true)} className="jv-btn-outline">
            Skip
          </button>
        </div>
      ) : (
        <div className="pt-3" style={{ borderTop: "1px solid var(--line)" }}>
          <PaperOrderForm
            sessionId={sessionId}
            prefillSymbol={signal.ticker}
            prefillAssetClass={signal.assetClass}
            prefillPrice={signal.currentPrice}
            compact
            onFilled={() => setSkipped(true)}
          />
        </div>
      )}

      <p className="text-[11px] mt-3" style={{ color: "var(--text-2)" }}>
        Based on a real historical backtest that passed this app&apos;s statistical validation checks — not a guarantee of future results.
      </p>
    </div>
  );
}

export function GuidedTradeSignalsTab() {
  const [signals, setSignals] = useState<GuidedTradeSignal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/guided-trade-signals");
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setSignals(json.signals as GuidedTradeSignal[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="jarvis flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: "var(--text-0)" }}>Today&apos;s Guided Setups</h2>
        <p className="jv-lede" style={{ marginBottom: 0 }}>
          A setup only shows up here when it&apos;s both real and live right now: it already passed this app&apos;s full
          statistical validation (real historical sample, corrected for testing many patterns at once, checked against
          data it wasn&apos;t built on), and the same signal is actually triggering today. No charts or statistics to
          read — see what historically happened, then decide whether to take it as a real-price paper trade or skip it.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--text-2)" }}>Checking today&apos;s validated setups…</p>}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
      )}

      {signals && signals.length === 0 && (
        <div className="jv-card">
          <p className="text-sm" style={{ color: "var(--text-1)" }}>
            No validated setups are triggering right now. This app only shows a card here when a setup is both
            real (backed by a statistically-confirmed track record) and actually happening today — it never shows
            one just to have something to show. Check back later, or explore the full Trading Agent tools for more.
          </p>
        </div>
      )}

      {signals && signals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {signals.map((s) => (
            <GuidedCard key={`${s.ticker}-${s.strategyType}`} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}
