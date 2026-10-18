"use client";

import { useCallback, useSyncExternalStore } from "react";
import { EMPTY_PREFS, PREFS_STORAGE_KEY, parsePrefs, pushRecent, togglePin, writePrefsToStorage, type StudyPrefs } from "@/lib/navigation/study-prefs";

// One shared copy so the library, the group workspace and the palette always agree, in this tab and (through the
// storage event) in other tabs. useSyncExternalStore needs a stable snapshot object, so it is cached per raw string.
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPrefs: StudyPrefs = EMPTY_PREFS;

function snapshot(): StudyPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parsePrefs(raw);
  }
  return cachedPrefs;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFS_STORAGE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: StudyPrefs) {
  writePrefsToStorage(next);
  // If storage is blocked the write did nothing; keep the in-memory copy so the UI still reacts for this page view.
  cachedPrefs = next;
  try {
    cachedRaw = window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    cachedRaw = undefined;
  }
  listeners.forEach((l) => l());
}

export function useStudyPrefs() {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => EMPTY_PREFS);
  const toggle = useCallback((key: string) => commit(togglePin(snapshot(), key)), []);
  const recent = useCallback((key: string) => {
    const cur = snapshot();
    const next = pushRecent(cur, key);
    if (next !== cur) commit(next);
  }, []);
  return { prefs, togglePin: toggle, pushRecent: recent };
}
