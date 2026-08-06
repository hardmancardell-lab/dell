"use client";

import { useCallback, useEffect, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { TraditionalCandidatesResult } from "@/lib/agents/trading-agent/types";

const READ_STYLE: Record<string, { color: string; borderColor: string; background: string }> = {
  constructive: { color: "var(--signal)", borderColor: "var(--signal-dim)", background: "rgba(79, 232, 208, 0.06)" },
  cautious: { color: "var(--danger)", borderColor: "var(--danger)", background: "rgba(232, 99, 122, 0.08)" },
  mixed: { color: "var(--text-1)", borderColor: "var(--line-bright)", background: "transparent" },
};

export function TraditionalPortfolioTab() {
  const { holdings, hydrated, addHolding } = usePortfolio();
  const [result, setResult] = useState<TraditionalCandidatesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const { track } = useTrackEvent();

  const heldSymbols = holdings.map((h) => h.symbol);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const heldParam = heldSymbols.length > 0 ? `?held=${encodeURIComponent(heldSymbols.join(","))}` : "";
      const res = await fetch(`/api/traditional-candidates${heldParam}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Traditional Portfolio", metadata: { endpoint: "traditional-candidates", status: res.status } });
      } else {
        setResult(json as TraditionalCandidatesResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Traditional Portfolio", metadata: { endpoint: "traditional-candidates", status: 0 } });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldSymbols.join(",")]);

  useEffect(() => {
    if (hydrated && !checked) {
      setChecked(true);
      runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked]);

  return (
    <div className="jarvis flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="jv-lede flex-1" style={{ marginBottom: 0 }}>
          Candidate securities seeded from the Research Agent&apos;s own Sector Recommendations (real macro-indicator
          trends per industry) and scored against the Value Checklist (7 fundamental criteria) — the same checklist
          used standalone in Security Analysis. Fundamental analysis on individual securities, not a market screen.
        </p>
        <button
          onClick={runCheck}
          disabled={loading}
          className="jv-btn-outline shrink-0"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result?.dataLimitations.map((d) => (
        <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
          <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
        </div>
      ))}

      {result && (
        <div className="flex flex-col gap-6">
          {result.groups.map((g) => (
            <section key={g.industryId} className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{g.industryName}</h3>
                <span className="jv-badge" style={READ_STYLE[g.overallRead]}>{g.overallRead}</span>
              </div>

              {g.note && <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>{g.note}</p>}

              {g.candidates.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.candidates.map((c) => (
                    <div
                      key={c.ticker}
                      className="flex items-center justify-between gap-2 p-3"
                      style={{ border: "1px solid var(--line)", background: "var(--ink-800)" }}
                    >
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-0)" }}>
                          {c.ticker}
                          {c.alreadyHeld && (
                            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-2)" }}>Held</span>
                          )}
                        </div>
                        {c.error ? (
                          <div className="text-xs" style={{ color: "var(--text-2)" }}>{c.error}</div>
                        ) : (
                          <div className="text-xs" style={{ color: "var(--text-2)" }}>
                            Value Checklist: {c.checklistPassCount}/{c.checklistTotal}
                          </div>
                        )}
                      </div>
                      {!c.error && !c.alreadyHeld && (
                        <button
                          onClick={() => {
                            addHolding(c.ticker, "equity", 1, 0, new Date().toISOString().slice(0, 10));
                            track("traditional_candidate_added", { tab: "Traditional Portfolio", symbol: c.ticker, metadata: { assetClass: "equity" } });
                          }}
                          className="jv-chip shrink-0"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="jv-note">
        For a full breakdown of any candidate&apos;s Value Checklist (earning power, NCAV, liquidity, solvency,
        dividends, valuation), use Top-Down Economic Analysis → Security Analysis directly. Adding a candidate here
        adds a 1-share placeholder holding at $0 cost basis — there&apos;s no in-place edit yet, so remove it on the
        Dashboard tab and re-add with real shares/cost basis once you&apos;ve actually bought in.
      </p>
    </div>
  );
}
