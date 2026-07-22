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
    <div>
      <p className="text-zinc-500 mb-6">
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
            className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
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
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {data.pairLabel && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
              <div className="font-semibold text-sm mb-1">{data.pairLabel}</div>
              <p className="text-sm text-zinc-500">{data.mechanismNote}</p>
            </div>
          )}

          {data.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}

          {data.coverageVolume.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Coverage Volume (7 days)</h2>
              <div className="flex items-end gap-1 h-24">
                {data.coverageVolume.map((p) => (
                  <div
                    key={p.date}
                    title={`${p.date}: ${p.value.toFixed(2)}%`}
                    className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t"
                    style={{ height: `${Math.max(4, (p.value / maxVolume) * 100)}%` }}
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-400 mt-2">
                % of monitored global news coverage matching this query, per day.
              </p>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold mb-3">Recent Articles</h2>
            {data.articles.length === 0 ? (
              <p className="text-sm text-zinc-500">No articles returned for this query.</p>
            ) : (
              <div className="space-y-3">
                {data.articles.map((a) => (
                  <a
                    key={a.url}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600"
                  >
                    <div className="font-medium text-sm">{a.title}</div>
                    <div className="text-xs text-zinc-500 mt-1">
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
