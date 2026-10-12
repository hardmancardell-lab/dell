"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { upcomingCatalysts, type CatalystImpact, type CatalystResult, type UpcomingCatalyst } from "@/lib/agents/trading-agent/skills/catalyst-calendar";

const DAYS_OPTIONS = [7, 14, 30, 60, 90];
const IMPACT_OPTIONS: { value: CatalystImpact; label: string }[] = [
  { value: "low", label: "All events" },
  { value: "medium", label: "Medium and high" },
  { value: "high", label: "High only" },
];

// The server and the first client render show nothing date-dependent; the browser's date is read through
// useSyncExternalStore so there is no hydration mismatch and no effect that sets state.
const subscribe = () => () => {};
const readToday = () => new Date().toISOString().slice(0, 10);
const readServerToday = () => "";

const IMPACT_COLOR: Record<CatalystImpact, string> = { high: "var(--danger)", medium: "var(--verdict)", low: "var(--text-2)" };

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function awayLabel(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

function EventRow({ e, symbol }: { e: UpcomingCatalyst; symbol: string | null }) {
  const raised = symbol && e.impactForSymbol !== e.impact;
  return (
    <div className="flex flex-col gap-1 py-2" style={{ borderBottom: "1px solid var(--ink-800)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="jv-badge" style={{ color: IMPACT_COLOR[e.impactForSymbol], borderColor: IMPACT_COLOR[e.impactForSymbol] }}>
          {e.impactForSymbol} impact
        </span>
        <span className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{e.name}</span>
        {e.time && <span className="font-mono text-xs" style={{ color: "var(--text-2)" }}>{e.time}</span>}
        <span className="font-mono text-xs" style={{ color: "var(--text-2)" }}>{e.region}{e.currency ? ` · ${e.currency}` : ""}</span>
      </div>
      {raised && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          Rated {e.impact} in general, {e.impactForSymbol} for {symbol} because one of its currencies is the subject of the event.
        </div>
      )}
      {e.note && <div className="text-xs" style={{ color: "var(--text-2)" }}>{e.note}</div>}
      <div className="text-xs" style={{ color: "var(--text-2)" }}>
        {e.basis === "official-schedule" ? (
          <>Official schedule{e.sourceUrl ? <> · <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">source</a></> : null}</>
        ) : (
          "Date worked out from a stated rule"
        )}
      </div>
    </div>
  );
}

/** The list of events and the notes under it, for a result already worked out. Presentational, so it can be rendered anywhere. */
export function CatalystCalendarResults({ result }: { result: CatalystResult }) {
  const groups: { date: string; events: UpcomingCatalyst[] }[] = [];
  for (const e of result.events) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.events.push(e);
    else groups.push({ date: e.date, events: [e] });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs" style={{ color: "var(--text-2)" }}>
        {result.events.length} event{result.events.length === 1 ? "" : "s"} from {dayLabel(result.from)} to {dayLabel(result.to)}
        {result.symbol ? ` for ${result.symbol}` : ""}.
      </div>

      {groups.length === 0 && (
        <div className="jv-card text-sm" style={{ color: "var(--text-2)" }}>
          Nothing in this window matches. Try a longer window or a lower impact filter.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.date} className="jv-card">
          <div className="jv-br-b" />
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{dayLabel(g.date)}</div>
            <div className="font-mono text-xs" style={{ color: "var(--text-2)" }}>{awayLabel(g.events[0].daysAway)}</div>
          </div>
          {g.events.map((e) => (
            <EventRow key={e.id} e={e} symbol={result.symbol} />
          ))}
        </div>
      ))}

      <div className="flex flex-col gap-2">
        {result.notes.map((n) => (
          <div key={n.slice(0, 40)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Dated events that can move markets, with an impact tag and the source of each date. Optionally filtered to what
 * matters for one ticker, forex pair or crypto symbol. A calendar only: it says when, not which way.
 */
export function CatalystCalendarTab() {
  const today = useSyncExternalStore(subscribe, readToday, readServerToday);
  const [symbol, setSymbol] = useState("");
  const [days, setDays] = useState(30);
  const [minImpact, setMinImpact] = useState<CatalystImpact>("low");

  const result = useMemo(() => (today ? upcomingCatalysts({ days, symbol: symbol.trim() || undefined, minImpact }, today) : null), [today, days, symbol, minImpact]);

  return (
    <div className="jarvis">
      <p className="jv-lede">
        What is scheduled, and how much attention it usually gets: central-bank decisions, US inflation and jobs reports, option expirations,
        elections and market closures. Enter a ticker, a forex pair such as GBP/JPY or a crypto symbol to see only what matters for it. This is a
        calendar, not a forecast: it says when, not which way.
      </p>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="SPY, GBP/JPY, BTC-USD (optional)" className="jv-input w-64" aria-label="Ticker, forex pair or crypto symbol" />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="jv-select" aria-label="How many days ahead">
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              Next {d} days
            </option>
          ))}
        </select>
        <select value={minImpact} onChange={(e) => setMinImpact(e.target.value as CatalystImpact)} className="jv-select" aria-label="Minimum impact">
          {IMPACT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!result && <div className="text-sm" style={{ color: "var(--text-2)" }}>Loading the calendar…</div>}

      {result && <CatalystCalendarResults result={result} />}
    </div>
  );
}
