"use client";

import { useState } from "react";
import { GLOSSARY_ENTRIES, type GlossaryCategory } from "@/lib/agents/trading-agent/skills/glossary";

const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  statistics: "Statistics",
  performance: "Performance Metrics",
  strategy: "Strategy Concepts",
  options: "Options & Macro",
};

const CATEGORIES: GlossaryCategory[] = ["statistics", "performance", "strategy", "options"];

export function GlossaryTab() {
  const [filter, setFilter] = useState("");

  const query = filter.trim().toLowerCase();
  const filtered = query
    ? GLOSSARY_ENTRIES.filter((e) => e.label.toLowerCase().includes(query) || e.definition.toLowerCase().includes(query))
    : GLOSSARY_ENTRIES;

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Every statistical, performance, and strategy term used across this app&apos;s backtest results — explained in
        plain language. Also available inline: click the ⓘ next to any metric column header for a quick popover
        without leaving the page.
      </p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search terms, e.g. &quot;p-value&quot; or &quot;drawdown&quot;"
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm mb-8"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">No terms match &quot;{filter}&quot;.</p>
      ) : (
        <div className="space-y-10">
          {CATEGORIES.map((cat) => {
            const entries = filtered.filter((e) => e.category === cat);
            if (entries.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="text-lg font-semibold mb-3">{CATEGORY_LABELS[cat]}</h2>
                <div className="space-y-4">
                  {entries.map((e) => (
                    <div key={e.term} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                      <div className="font-medium text-sm mb-1">{e.label}</div>
                      <p className="text-sm text-zinc-500">{e.definition}</p>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
