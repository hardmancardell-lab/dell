// Pure: turns Alpaca corporate-action responses into chart events and places them on bars as markers.
// Shape of the response (docs.alpaca.markets, v1 corporate actions): { corporate_actions: { forward_splits: [...],
// reverse_splits: [...], cash_dividends: [...] }, next_page_token }. Not yet checked against a live response (no keys here):
// the parser is deliberately tolerant and drops anything it cannot read instead of guessing.
import type { CorporateEvent } from "../data/market-data-types";

function dayMs(iso: unknown): number | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

function trimNum(n: number): string {
  return String(Number(n.toFixed(4)));
}

export function normalizeAlpacaActions(json: unknown): CorporateEvent[] {
  const ca = (json as { corporate_actions?: Record<string, unknown> } | null)?.corporate_actions;
  if (!ca || typeof ca !== "object") return [];
  const out: CorporateEvent[] = [];
  const rows = (k: string): Record<string, unknown>[] => (Array.isArray(ca[k]) ? (ca[k] as Record<string, unknown>[]) : []);

  for (const kind of ["forward_splits", "reverse_splits"]) {
    for (const r of rows(kind)) {
      const date = dayMs(r.ex_date) ?? dayMs(r.process_date);
      const newRate = num(r.new_rate);
      const oldRate = num(r.old_rate);
      if (date === null || newRate === null || oldRate === null || newRate <= 0 || oldRate <= 0) continue;
      out.push({ kind: "split", dateMs: date, ratio: newRate / oldRate, label: `Split ${trimNum(newRate)}-for-${trimNum(oldRate)}` });
    }
  }
  for (const r of rows("cash_dividends")) {
    const date = dayMs(r.ex_date);
    const amount = num(r.rate);
    if (date === null || amount === null || amount <= 0) continue;
    out.push({ kind: "dividend", dateMs: date, amount, label: `Dividend $${trimNum(amount)}${r.special === true ? " (special)" : ""}` });
  }
  return out.sort((a, b) => a.dateMs - b.dateMs);
}

export interface EventMarker {
  /** Epoch seconds of the bar the marker sits on. */
  time: number;
  position: "belowBar" | "aboveBar";
  shape: "circle" | "square" | "arrowUp";
  text: string;
  /** "split" or "dividend" decides the colour; a bar with both is a split. */
  kind: "split" | "dividend";
  /** Full descriptions of every event on this bar. */
  detail: string[];
}

/**
 * Places events on bars. A bar holds an event when the event's UTC date falls inside [bar start, next bar start) for
 * daily and longer bars; for intraday bars the event goes on the first bar of that date (ET date of the bar). Events
 * outside the drawn range are dropped. Several events on one bar become one marker.
 */
export function eventsToMarkers(
  events: readonly CorporateEvent[],
  bars: readonly { datetime: number }[],
  etDay: (ms: number) => string
): EventMarker[] {
  if (bars.length === 0 || events.length === 0) return [];
  const first = bars[0].datetime;
  const lastStart = bars[bars.length - 1].datetime;
  const barMs = bars.length > 1 ? Math.max(1, Math.round((lastStart - first) / (bars.length - 1))) : 86_400_000;
  const intraday = bars.length > 1 && barMs < 20 * 3_600_000;

  // first bar index per ET date (intraday)
  const firstOfDay = new Map<string, number>();
  if (intraday) bars.forEach((b, i) => { const d = etDay(b.datetime); if (!firstOfDay.has(d)) firstOfDay.set(d, i); });

  const byBar = new Map<number, CorporateEvent[]>();
  for (const e of events) {
    let idx = -1;
    if (intraday) {
      idx = firstOfDay.get(new Date(e.dateMs).toISOString().slice(0, 10)) ?? -1;
    } else {
      // last bar whose start is <= the event date (end of day), within one bar length of the data
      let lo = 0, hi = bars.length - 1;
      const t = e.dateMs + 86_399_000;
      if (t < first || e.dateMs > lastStart + barMs) continue;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid].datetime <= t) lo = mid; else hi = mid - 1;
      }
      idx = lo;
    }
    if (idx < 0) continue;
    const list = byBar.get(idx) ?? [];
    list.push(e);
    byBar.set(idx, list);
  }
  return [...byBar.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, list]) => {
      const split = list.find((e) => e.kind === "split");
      const text = split ? `S ${split.label.replace("Split ", "")}` : list.length > 1 ? `D x${list.length}` : `D ${list[0].amount !== undefined ? `$${trimNum(list[0].amount)}` : ""}`.trim();
      return {
        time: Math.floor(bars[idx].datetime / 1000),
        position: split ? "aboveBar" : "belowBar",
        shape: split ? "square" : "circle",
        text,
        kind: split ? "split" : "dividend",
        detail: list.map((e) => `${new Date(e.dateMs).toISOString().slice(0, 10)}: ${e.label}`),
      } as EventMarker;
    });
}
