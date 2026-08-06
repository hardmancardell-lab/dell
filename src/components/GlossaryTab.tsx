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
    <div className="jarvis">
      <p className="jv-lede">
        Every statistical, performance, and strategy term used across this app&apos;s backtest results — explained in
        plain language. Also available inline: click the ⓘ next to any metric column header for a quick popover
        without leaving the page.
      </p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search terms, e.g. &quot;p-value&quot; or &quot;drawdown&quot;"
        className="jv-input w-full mb-8"
      />

      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>No terms match &quot;{filter}&quot;.</p>
      ) : (
        <div className="flex flex-col gap-10">
          {CATEGORIES.map((cat) => {
            const entries = filtered.filter((e) => e.category === cat);
            if (entries.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--text-0)" }}>{CATEGORY_LABELS[cat]}</h2>
                <div className="flex flex-col gap-4">
                  {entries.map((e) => (
                    <div key={e.term} className="jv-card">
                      <div className="font-medium text-sm mb-1" style={{ color: "var(--text-0)" }}>{e.label}</div>
                      <p className="text-sm" style={{ color: "var(--text-1)" }}>{e.definition}</p>
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
