/**
 * Pinned favourites and recents for studies, tabs and tickers. Pure functions over a small value (so they test under plain
 * Node) plus a tolerant reader/writer for localStorage. Every access is wrapped: storage can be blocked or throw, and the
 * app must still work without it.
 *
 * Keys look like "study:backtest", "tab:trading/equities" or "ticker:AAPL".
 */
export interface StudyPrefs {
  pins: string[];
  recents: string[];
}

export const PREFS_STORAGE_KEY = "dellegate-nav-prefs-v1";
export const MAX_RECENTS = 8;
export const MAX_PINS = 12;

const KEY_RE = /^(study|tab|ticker):[A-Za-z0-9:/_.=^-]{1,60}$/;

export const EMPTY_PREFS: StudyPrefs = Object.freeze({ pins: [], recents: [] }) as StudyPrefs;

function clean(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) if (typeof v === "string" && KEY_RE.test(v) && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}

export function parsePrefs(raw: string | null | undefined): StudyPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const j = JSON.parse(raw);
    return { pins: clean(j?.pins, MAX_PINS), recents: clean(j?.recents, MAX_RECENTS) };
  } catch {
    return EMPTY_PREFS;
  }
}

export function serializePrefs(p: StudyPrefs): string {
  return JSON.stringify({ pins: p.pins, recents: p.recents });
}

export function togglePin(p: StudyPrefs, key: string): StudyPrefs {
  if (!KEY_RE.test(key)) return p;
  if (p.pins.includes(key)) return { ...p, pins: p.pins.filter((k) => k !== key) };
  return { ...p, pins: [key, ...p.pins].slice(0, MAX_PINS) };
}

export function pushRecent(p: StudyPrefs, key: string): StudyPrefs {
  if (!KEY_RE.test(key)) return p;
  if (p.recents[0] === key) return p;
  return { ...p, recents: [key, ...p.recents.filter((k) => k !== key)].slice(0, MAX_RECENTS) };
}

export function readPrefsFromStorage(): StudyPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_STORAGE_KEY));
  } catch {
    return EMPTY_PREFS;
  }
}

export function writePrefsToStorage(p: StudyPrefs): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, serializePrefs(p));
  } catch {
    // Storage full or blocked: pins and recents just last for this page view.
  }
}
