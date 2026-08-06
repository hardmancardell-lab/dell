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
    <div className="pt-3 first:pt-0" style={{ borderTop: "1px solid var(--line)" }}>
      <a href={source.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--text-0)" }}>
        {source.outletName} ↗
      </a>
      {headlines.length === 0 ? (
        <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
          {source.rssUrl === null ? "No working public RSS feed found — visit the site directly." : `Unavailable right now: ${error}`}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 mt-1.5">
          {headlines.map((h) => (
            <li key={h.url} className="text-sm">
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-1)" }}>
                {h.title}
              </a>
              {h.publishedAt && <span className="text-[11px]" style={{ color: "var(--text-2)" }}> — {fmtDate(h.publishedAt)}</span>}
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
    <div className="jv-card flex flex-col gap-3">
      <div className="jv-br-b" />
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>{country}</div>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
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
    <div className="jarvis">
      <p className="jv-lede">
        One card per country — real outlets grounded, top 3 headlines from each. Not a viewership ranking (no API
        publishes TV/media audience data); these are each country&apos;s most internationally recognized financial-news
        outlets, hand-researched and live-verified.
      </p>

      {loading && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading global news sources…</p>}

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result?.dataLimitations.map((d) => (
        <div
          key={d.slice(0, 40)}
          className="jv-card mb-2 text-xs"
          style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}
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
