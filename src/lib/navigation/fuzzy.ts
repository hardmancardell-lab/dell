/**
 * Small fuzzy matcher for the Study Library search box and the command palette. No dependency, deterministic.
 *
 * A query is split into words; every word has to match somewhere in the text (AND). A word scores highest when it
 * starts a word in the text, next when it is a plain substring, and lowest when its letters appear in order
 * (so "bktst" still finds "backtest"). Returns null when any word fails to match, otherwise a score where higher is better.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const hay = text.toLowerCase();
  let total = 0;
  for (const w of words) {
    const idx = hay.indexOf(w);
    if (idx >= 0) {
      const atWordStart = idx === 0 || /[^a-z0-9]/.test(hay[idx - 1]);
      total += (atWordStart ? 100 : 60) - Math.min(idx, 40) * 0.5 + w.length;
      continue;
    }
    let pos = -1;
    let gaps = 0;
    let ok = true;
    for (const ch of w) {
      const next = hay.indexOf(ch, pos + 1);
      if (next < 0) { ok = false; break; }
      if (pos >= 0) gaps += next - pos - 1;
      pos = next;
    }
    if (!ok || w.length < 3) return null; // a 1-2 letter word must match as a substring, otherwise it matches everything
    total += Math.max(5, 30 - gaps);
  }
  return total;
}

/** Filter and rank items by a query over several fields (the first field weighs most). Stable for equal scores. */
export function fuzzyRank<T>(query: string, items: T[], fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items.slice();
  const scored: Array<{ item: T; score: number; order: number }> = [];
  items.forEach((item, order) => {
    const [primary, ...rest] = fields(item);
    const a = fuzzyScore(query, primary ?? "");
    const b = fuzzyScore(query, [primary, ...rest].join(" "));
    if (a === null && b === null) return;
    // Shorter titles win ties: "Signal Backtest" is a better answer to "backtest" than "Paper Backtest Log".
    scored.push({ item, score: (a ?? 0) * 2 + (b ?? 0) - (primary ?? "").length, order });
  });
  scored.sort((x, y) => y.score - x.score || x.order - y.order);
  return scored.map((s) => s.item);
}
