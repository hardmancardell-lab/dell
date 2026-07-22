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
    <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-sm font-semibold mb-3">News — {symbol}</div>

      {loading && <p className="text-sm text-zinc-500">Loading news…</p>}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {result.companyNews !== null && (
            <details open className="rounded-lg border border-zinc-100 dark:border-zinc-900 p-3">
              <summary className="text-sm font-medium cursor-pointer">Company News ({result.companyNews.length})</summary>
              {result.companyNews.length === 0 ? (
                <p className="text-sm text-zinc-500 mt-2">No recent company news found.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {result.companyNews.map((a) => (
                    <li key={a.url || a.title} className="text-sm">
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {a.title}
                      </a>
                      <span className="text-xs text-zinc-500 ml-2">
                        {a.source} &middot; {fmtDate(a.publishedDate)} &middot; {a.kind === "press-release" ? "Press Release" : "News"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {result.secFilings !== null && (
            <details className="rounded-lg border border-zinc-100 dark:border-zinc-900 p-3">
              <summary className="text-sm font-medium cursor-pointer">SEC Filings ({result.secFilings.length})</summary>
              {result.secFilings.length === 0 ? (
                <p className="text-sm text-zinc-500 mt-2">No recent 10-K/10-Q/8-K filings found.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {result.secFilings.map((f) => (
                    <li key={f.url} className="text-sm">
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline font-medium">
                        {f.form}
                      </a>
                      <span className="text-xs text-zinc-500 ml-2">{fmtDate(f.filingDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {result.macroNews && (
            <details className="rounded-lg border border-zinc-100 dark:border-zinc-900 p-3">
              <summary className="text-sm font-medium cursor-pointer">
                Macro / Sector News {result.macroNews.pairLabel ? `(${result.macroNews.pairLabel})` : ""}
              </summary>
              {result.macroNews.mechanismNote && <p className="text-xs text-zinc-500 mt-2">{result.macroNews.mechanismNote}</p>}
              {result.macroNews.articles.length === 0 ? (
                <p className="text-sm text-zinc-500 mt-2">No recent articles found.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {result.macroNews.articles.map((a) => (
                    <li key={a.url} className="text-sm">
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {a.title}
                      </a>
                      <span className="text-xs text-zinc-500 ml-2">
                        {a.domain} &middot; {fmtDate(a.date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {result.dataLimitations.length > 0 && (
            <div className="space-y-2">
              {result.dataLimitations.map((d) => (
                <div
                  key={d.slice(0, 30)}
                  className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
                >
                  {d}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
