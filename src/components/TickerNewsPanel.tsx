"use client";

import { useEffect, useState } from "react";
import type { AssetClass, TickerNewsPanelResult } from "@/lib/agents/trading-agent/types";

function fmtDate(d: string): string {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString();
}

export function TickerNewsPanel({ symbol, assetClass }: { symbol: string; assetClass: AssetClass }) {
  const [result, setResult] = useState<TickerNewsPanelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/ticker-news?ticker=${encodeURIComponent(symbol)}&assetClass=${assetClass}`)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) setError(json.error ?? "Unknown error");
        else setResult(json as TickerNewsPanelResult);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, assetClass]);

  if (!symbol) return null;

  return (
    <div className="jarvis mt-4">
      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-0)" }}>News — {symbol}</div>

        {loading && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading news…</p>}

        {error && (
          <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            <div className="text-sm">{error}</div>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3">
            {result.companyNews !== null && (
              <details open className="jv-card">
                <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
                  Company News ({result.companyNews.length})
                </summary>
                {result.companyNews.length === 0 ? (
                  <p className="text-sm mt-2" style={{ color: "var(--text-2)" }}>No recent company news found.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.companyNews.map((a) => (
                      <li key={a.url || a.title} className="text-sm">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-0)" }}>
                          {a.title}
                        </a>
                        <span className="text-xs ml-2" style={{ color: "var(--text-2)" }}>
                          {a.source} &middot; {fmtDate(a.publishedDate)} &middot; {a.kind === "press-release" ? "Press Release" : "News"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}

            {result.secFilings !== null && (
              <details className="jv-card">
                <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
                  SEC Filings ({result.secFilings.length})
                </summary>
                {result.secFilings.length === 0 ? (
                  <p className="text-sm mt-2" style={{ color: "var(--text-2)" }}>No recent 10-K/10-Q/8-K filings found.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.secFilings.map((f) => (
                      <li key={f.url} className="text-sm">
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline font-medium" style={{ color: "var(--text-0)" }}>
                          {f.form}
                        </a>
                        <span className="text-xs ml-2" style={{ color: "var(--text-2)" }}>{fmtDate(f.filingDate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}

            {result.macroNews && (
              <details className="jv-card">
                <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
                  Macro / Sector News {result.macroNews.pairLabel ? `(${result.macroNews.pairLabel})` : ""}
                </summary>
                {result.macroNews.mechanismNote && <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>{result.macroNews.mechanismNote}</p>}
                {result.macroNews.articles.length === 0 ? (
                  <p className="text-sm mt-2" style={{ color: "var(--text-2)" }}>No recent articles found.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.macroNews.articles.map((a) => (
                      <li key={a.url} className="text-sm">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-0)" }}>
                          {a.title}
                        </a>
                        <span className="text-xs ml-2" style={{ color: "var(--text-2)" }}>
                          {a.domain} &middot; {fmtDate(a.date)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}

            {result.dataLimitations.length > 0 && (
              <div className="flex flex-col gap-2">
                {result.dataLimitations.map((d) => (
                  <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                    {d}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
