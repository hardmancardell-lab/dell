"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { WatchlistEntry, WatchlistNewsItem, WatchlistNewsResult } from "@/lib/agents/trading-agent/types";

function fmtDate(d: string): string {
  // GDELT's seendate looks like "20260730T142410Z" — not directly parseable by Date().
  const m = d.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return d;
  const parsed = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleString();
}

function ItemCard({ item }: { item: WatchlistNewsItem }) {
  return (
    <div className="jv-card">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>{item.symbol}</span>
        {item.label !== item.symbol && <span className="text-xs truncate" style={{ color: "var(--text-2)" }}>{item.label}</span>}
        {!item.curated && item.articles.length > 0 && (
          <span className="text-[10px] uppercase tracking-wide shrink-0" style={{ color: "var(--text-2)" }}>generic query</span>
        )}
      </div>
      {item.articles.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>{item.error ?? "No articles found."}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {item.articles.map((a) => (
            <li key={a.url} className="text-sm">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-0)" }}>
                {a.title}
              </a>
              <div className="text-[11px]" style={{ color: "var(--text-2)" }}>
                {a.domain} — {fmtDate(a.date)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WatchlistNewsPanel({ kind, entries }: { kind: "company" | "currency"; entries: WatchlistEntry[] }) {
  const [result, setResult] = useState<WatchlistNewsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  const scopedEntries = entries.filter((e) => e.assetClass === (kind === "company" ? "equity" : "forex"));
  const uniqueCount = new Set(scopedEntries.map((e) => e.symbol)).size;
  const endpoint = kind === "company" ? "/api/watchlist-company-news" : "/api/watchlist-currency-news";
  const estimatedSeconds = Math.max(0, uniqueCount - 1) * 5.5 + uniqueCount * 2;

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: scopedEntries }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Watchlist News", metadata: { endpoint, status: res.status } });
      } else {
        setResult(json as WatchlistNewsResult);
        track("watchlist_news_run", { tab: "Watchlist News", metadata: { kind, count: uniqueCount } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Watchlist News", metadata: { endpoint, status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  if (uniqueCount === 0) return null;

  return (
    <div className="jarvis mt-4">
      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>
          {kind === "company" ? "News for Your Watchlist" : "News for Your Watchlist Pairs"}
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Real headlines per {kind === "company" ? "company" : "currency pair"} on your watchlist, via GDELT (the same
          source Global News uses) since {kind === "company" ? "FMP's company-news endpoint is blocked on the free plan" : "coverage needs to be per-pair, not just the 6 curated majors"}.
          GDELT rate-limits to ~1 request/5s, so {uniqueCount} {uniqueCount === 1 ? "symbol" : "symbols"} takes roughly {estimatedSeconds}s — this only runs when you ask it to.
        </p>
        <button
          onClick={run}
          disabled={loading}
          className="jv-btn mb-4"
        >
          {loading ? `Fetching… (~${estimatedSeconds}s)` : `Fetch News for ${uniqueCount} ${uniqueCount === 1 ? "Symbol" : "Symbols"}`}
        </button>

        {error && (
          <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            <div className="text-sm">{error}</div>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3">
            {result.dataLimitations.map((d) => (
              <div key={d.slice(0, 40)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                {d}
              </div>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {result.items.map((item) => (
                <ItemCard key={item.symbol} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
