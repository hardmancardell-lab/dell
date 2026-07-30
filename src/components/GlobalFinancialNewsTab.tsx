"use client";

import { useEffect, useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { GlobalFinancialNewsResult, GlobalNewsSourceResult } from "@/lib/agents/trading-agent/types";

function fmtDate(d: string | null): string {
  if (!d) return "";
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString();
}

function OutletSection({ item }: { item: GlobalNewsSourceResult }) {
  const { source, headlines, error } = item;
  return (
    <div className="border-t border-zinc-100 dark:border-zinc-900 pt-3 first:border-t-0 first:pt-0">
      <a href={source.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline">
        {source.outletName} ↗
      </a>
      {headlines.length === 0 ? (
        <p className="text-xs text-zinc-500 mt-1">
          {source.rssUrl === null ? "No working public RSS feed found — visit the site directly." : `Unavailable right now: ${error}`}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 mt-1.5">
          {headlines.map((h) => (
            <li key={h.url} className="text-sm">
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {h.title}
              </a>
              {h.publishedAt && <span className="text-[11px] text-zinc-400"> — {fmtDate(h.publishedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CountryCard({ country, items }: { country: string; items: GlobalNewsSourceResult[] }) {
  const liveCount = items.filter((i) => i.headlines.length > 0).length;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{country}</div>
        <span className="text-[10px] uppercase tracking-wide text-zinc-400">
          {liveCount}/{items.length} live
        </span>
      </div>
      {items.map((item) => (
        <OutletSection key={item.source.outletName} item={item} />
      ))}
    </div>
  );
}

export function GlobalFinancialNewsTab() {
  const [result, setResult] = useState<GlobalFinancialNewsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const { track } = useTrackEvent();

  useEffect(() => {
    if (checked) return;
    setChecked(true);
    setLoading(true);
    fetch("/api/global-financial-news")
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) {
          setError(json.error ?? "Unknown error");
          track("api_error", { tab: "Global Financial News", metadata: { endpoint: "global-financial-news", status: 500 } });
        } else {
          setResult(json as GlobalFinancialNewsResult);
          track("global_news_viewed", { tab: "Global Financial News" });
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unknown error");
        track("api_error", { tab: "Global Financial News", metadata: { endpoint: "global-financial-news", status: 0 } });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const byCountry: { country: string; items: GlobalNewsSourceResult[] }[] = [];
  if (result) {
    for (const item of result.results) {
      const group = byCountry.find((g) => g.country === item.source.country);
      if (group) group.items.push(item);
      else byCountry.push({ country: item.source.country, items: [item] });
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-4">
        One card per country — real outlets grounded, top 3 headlines from each. Not a viewership ranking (no API
        publishes TV/media audience data); these are each country&apos;s most internationally recognized financial-news
        outlets, hand-researched and live-verified.
      </p>

      {loading && <p className="text-sm text-zinc-500">Loading global news sources…</p>}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {result?.dataLimitations.map((d) => (
        <div
          key={d.slice(0, 40)}
          className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400 mb-2"
        >
          {d}
        </div>
      ))}

      {byCountry.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {byCountry.map((g) => (
            <CountryCard key={g.country} country={g.country} items={g.items} />
          ))}
        </div>
      )}
    </div>
  );
}
