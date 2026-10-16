"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_DEALER_SIGN, parseDealerSign, type DealerSignMode } from "./skills/gex-sign";

export const DEALER_SIGN_KEY = "dellegate.dealerSign";

/**
 * One dealer-positioning setting for every toggle (Options dashboard and Gamma Heat Map). A module-level store, so every
 * mounted consumer in the page shares it; the browser's `storage` event carries a change made in another tab. Storage can
 * be empty, blocked or throw, so every access is wrapped and the default ("standard") is the fallback.
 *
 * Server render and the first client render use the default (the server snapshot); React then re-renders with the stored
 * value, so there is no hydration mismatch.
 */
let cached: DealerSignMode | null = null;
const listeners = new Set<() => void>();
let storageListening = false;

function readStored(): DealerSignMode {
  try {
    return parseDealerSign(window.localStorage.getItem(DEALER_SIGN_KEY));
  } catch {
    return DEFAULT_DEALER_SIGN;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function onStorage(e: StorageEvent) {
  // key === null means the whole storage was cleared.
  if (e.key !== null && e.key !== DEALER_SIGN_KEY) return;
  cached = parseDealerSign(e.key === null ? null : e.newValue);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListening) {
    window.addEventListener("storage", onStorage);
    storageListening = true;
  }
  // The cache may predate this subscription (another tab changed it, or storage was edited); re-read once.
  const fresh = readStored();
  if (fresh !== cached) {
    cached = fresh;
    listener();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListening) {
      window.removeEventListener("storage", onStorage);
      storageListening = false;
    }
  };
}

function getSnapshot(): DealerSignMode {
  if (cached === null) cached = readStored();
  return cached;
}

function getServerSnapshot(): DealerSignMode {
  return DEFAULT_DEALER_SIGN;
}

function setStored(mode: DealerSignMode) {
  cached = mode;
  try {
    window.localStorage.setItem(DEALER_SIGN_KEY, mode);
  } catch {
    // Storage unavailable: the choice still holds for this page load.
  }
  emit();
}

/** [mode, setMode] for the shared dealer-positioning setting. */
export function useDealerSign(): [DealerSignMode, (mode: DealerSignMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((m: DealerSignMode) => setStored(m), []);
  return [mode, setMode];
}
