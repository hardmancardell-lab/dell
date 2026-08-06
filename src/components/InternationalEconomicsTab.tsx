"use client";

import { useState } from "react";
import { MAJOR_PAIR_KEYWORDS } from "@/lib/agents/trading-agent/skills/geopolitical-news";
import type { GeopoliticalNewsResult } from "@/lib/agents/trading-agent/types";

export function InternationalEconomicsTab() {
  const [freeform, setFreeform] = useState("");
  const [data, setData] = useState<GeopoliticalNewsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadPair(pair: string) {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/geopolitical-news?pair=${encodeURIComponent(pair)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setData(json as GeopoliticalNewsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function loadFreeform(e: React.FormEvent) {
    e.preventDefault();
    if (!freeform.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/geopolitical-news?query=${encodeURIComponent(freeform)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setData(json as GeopoliticalNewsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const maxVolume = data ? Math.max(1, ...data.coverageVolume.map((p) => p.value)) : 1;

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Global news coverage tied to the geopolitical/macro drivers behind
        major currency pairs, via GDELT&apos;s global event database. A spike
        in coverage volume is itself a signal that something is moving
        markets, before you even read the articles.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {MAJOR_PAIR_KEYWORDS.map((p) => (
          <button
            key={p.pair}
            onClick={() => loadPair(p.pair)}
            disabled={loading}
            className="jv-btn-outline disabled:opacity-50"
          >
            {p.pair}
          </button>
        ))}
      </div>

      <form onSubmit={loadFreeform} className="flex gap-3 mb-6">
        <input
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          placeholder="Or search anything, e.g. a country, commodity, or event"
          className="jv-input flex-1"
        />
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-6">
          {data.pairLabel && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="font-semibold text-sm mb-1" style={{ color: "var(--text-0)" }}>{data.pairLabel}</div>
              <p className="text-sm" style={{ color: "var(--text-2)" }}>{data.mechanismNote}</p>
            </div>
          )}

          {data.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="jv-card text-xs"
              style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}
            >
              {d}
            </div>
          ))}

          {data.coverageVolume.length > 0 && (
            <section>
              <div className="jv-strip-title">Coverage Volume (7 days)</div>
              <div className="flex items-end gap-1 h-24">
                {data.coverageVolume.map((p) => (
                  <div
                    key={p.date}
                    title={`${p.date}: ${p.value.toFixed(2)}%`}
                    className="flex-1"
                    style={{ height: `${Math.max(4, (p.value / maxVolume) * 100)}%`, background: "var(--signal)" }}
                  />
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                % of monitored global news coverage matching this query, per day.
              </p>
            </section>
          )}

          <section>
            <div className="jv-strip-title">Recent Articles</div>
            {data.articles.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>No articles returned for this query.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.articles.map((a) => (
                  <a
                    key={a.url}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="jv-card block"
                    style={{ transition: "border-color 0.15s" }}
                  >
                    <div className="jv-br-b" />
                    <div className="font-medium text-sm" style={{ color: "var(--text-0)" }}>{a.title}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                      {a.domain} {a.sourceCountry ? `· ${a.sourceCountry}` : ""} · {a.date}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
