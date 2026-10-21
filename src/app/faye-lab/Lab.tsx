"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createLabClient } from "@/lib/faye/lab/client";
import { createLabStore } from "./labStore";
import { LabView } from "./LabView";

/** How often the page asks for new results while a test is waiting or running (the tab must be visible). */
const POLL_MS = 15_000;

/**
 * The Lab container: builds the store with the real browser client, loads once on mount, and keeps the results fresh while a test
 * is waiting or running. The server page has already checked that the visitor is the owner (anyone else gets a 404); the routes
 * check again on every call.
 */
export function Lab({ enabled }: { enabled: boolean }) {
  const store = useMemo(() => createLabStore({ client: createLabClient(), enabled }), [enabled]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    void store.load();
  }, [store]);

  const waiting = state.pending.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void store.refreshRuns();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, store]);

  return <LabView state={state} store={store} />;
}
