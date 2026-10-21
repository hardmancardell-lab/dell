"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  DEFAULT_UNDO_MINUTES,
  createMemoryClient,
  saveTextFile,
  undoSecondsLeft,
  type ExportFile,
  type MemCategory,
  type MemFail,
  type MemItem,
  type MemSettings,
  type MemoryClient,
} from "@/lib/faye/memory-client";
import { AboutMeView } from "./AboutMeView";

/**
 * Faye's "About me" panel: the owner's notes, in one place, easy to see, correct, pause, export and delete.
 *
 * This file holds the state machine (a tiny store, so the same code runs in the browser and in the tests with a fake API) and the
 * container component. The screen itself is AboutMeView.tsx and the CSS is AboutMeStyles.tsx.
 *
 * Everything is plain text: notes come from the owner or from Faye's counters, and are drawn as React text nodes only.
 */

export type HeavyAction = "export" | "delete_all" | "erase";

export interface Notice {
  /** Goes up on every message, so the live region announces a repeated sentence again. */
  seq: number;
  tone: "ok" | "error";
  text: string;
}

export interface AboutMeState {
  load: "idle" | "loading" | "ready" | "error";
  loadError: string;
  /** FAYE_MEMORY_ENABLED on the server. Off: notes are not used in answers yet, but the privacy controls still work. */
  enabled: boolean;
  settings: MemSettings;
  /** Waiting for the owner's OK (approve-first is the default). */
  proposals: MemItem[];
  /** Approved and in use. */
  notes: MemItem[];
  /** Faded away over time (status retired). One tap to bring back. */
  faded: MemItem[];
  rejected: MemItem[];
  /** Deleted within the undo window. */
  deleted: MemItem[];
  undoMinutes: number;
  /** Keys of the calls in flight: a note id, or "settings", "add", "export", "delete_all", "erase". */
  busy: string[];
  notice: Notice | null;
  /** Set when export, delete all or erase answered reauth_required. */
  reauth: HeavyAction | null;
  nowMs: number;
}

export interface StoreDeps {
  client: MemoryClient;
  now?: () => number;
  save?: (file: ExportFile) => boolean;
}

export interface AboutMeStore {
  getState(): AboutMeState;
  subscribe(fn: () => void): () => void;
  load(quiet?: boolean): Promise<boolean>;
  tick(): void;
  approve(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
  edit(id: string, fact: string, category?: MemCategory, approveAfter?: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  undo(id: string): Promise<boolean>;
  revive(id: string): Promise<boolean>;
  add(fact: string, category?: MemCategory): Promise<boolean>;
  setPaused(paused: boolean): Promise<boolean>;
  setShowUsed(show: boolean): Promise<boolean>;
  exportAll(): Promise<boolean>;
  deleteAll(): Promise<boolean>;
  erase(): Promise<boolean>;
  clearReauth(): void;
  notify(tone: Notice["tone"], text: string): void;
}

export function initialState(now = Date.now()): AboutMeState {
  return {
    load: "idle",
    loadError: "",
    enabled: false,
    settings: { learningPaused: false, showUsedNotes: true },
    proposals: [],
    notes: [],
    faded: [],
    rejected: [],
    deleted: [],
    undoMinutes: DEFAULT_UNDO_MINUTES,
    busy: [],
    notice: null,
    reauth: null,
    nowMs: now,
  };
}

const byNewest = (a: MemItem, b: MemItem) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0;

export function createAboutMeStore(deps: StoreDeps): AboutMeStore {
  const { client } = deps;
  const clock = deps.now ?? (() => Date.now());
  const save = deps.save ?? ((f: ExportFile) => saveTextFile(f.filename, f.text));
  let state: AboutMeState = initialState(clock());
  let seq = 0;
  const subs = new Set<() => void>();

  const set = (patch: Partial<AboutMeState>) => {
    state = { ...state, ...patch };
    for (const fn of [...subs]) fn();
  };
  const notice = (tone: Notice["tone"], text: string) => set({ notice: { seq: ++seq, tone, text } });
  const begin = (key: string): boolean => {
    if (state.busy.includes(key)) return false;
    set({ busy: [...state.busy, key] });
    return true;
  };
  const end = (key: string) => set({ busy: state.busy.filter((k) => k !== key) });
  const fail = (r: MemFail) => notice("error", r.message);

  /** Shared wrapper: one call in flight per key, the failure sentence on error, a fresh list on success. */
  async function act<T>(key: string, call: () => Promise<{ ok: true; data: T } | MemFail>, onOk: (d: T) => string | void, opts: { heavy?: HeavyAction; reloadOnFail?: boolean } = {}): Promise<boolean> {
    if (!begin(key)) return false;
    try {
      const r = await call();
      if (!r.ok) {
        if (r.code === "reauth_required" && opts.heavy) set({ reauth: opts.heavy });
        fail(r);
        if (opts.reloadOnFail || r.code === "not_found") await load(true);
        return false;
      }
      if (opts.heavy) set({ reauth: null });
      const msg = onOk(r.data);
      await load(true);
      if (msg) notice("ok", msg);
      return true;
    } finally {
      end(key);
    }
  }

  async function load(quiet = false): Promise<boolean> {
    if (!quiet) set({ load: "loading", loadError: "" });
    const r = await client.list({ includeDeleted: true });
    if (!r.ok) {
      if (quiet && state.load === "ready") return false; // keep what is on screen; the action's own message already told the story
      set({ load: "error", loadError: r.message });
      return false;
    }
    const nowMs = clock();
    const items = r.data.items;
    const live = items.filter((i) => !i.deletedAt);
    set({
      load: "ready",
      loadError: "",
      enabled: r.data.enabled,
      settings: r.data.settings,
      proposals: live.filter((i) => i.status === "proposed").sort(byNewest),
      notes: live.filter((i) => i.status === "approved").sort(byNewest),
      faded: live.filter((i) => i.status === "retired").sort(byNewest),
      rejected: live.filter((i) => i.status === "rejected").sort(byNewest),
      deleted: items.filter((i) => i.deletedAt && undoSecondsLeft(i.deletedAt, state.undoMinutes, nowMs) > 0).sort((a, b) => Date.parse(b.deletedAt ?? "") - Date.parse(a.deletedAt ?? "")),
      nowMs,
    });
    return true;
  }

  const pausedNote = () => (state.settings.learningPaused ? " Learning is paused, so Faye is not using notes right now." : "");

  const api: AboutMeStore = {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    load,
    tick() {
      const nowMs = clock();
      const deleted = state.deleted.filter((i) => undoSecondsLeft(i.deletedAt, state.undoMinutes, nowMs) > 0);
      set({ nowMs, deleted });
    },
    approve: (id) => act(id, () => client.decide(id, "approve"), () => `Approved. Faye can use this note.${pausedNote()}`),
    reject: (id) => act(id, () => client.decide(id, "reject"), () => "Rejected. Faye will not use it."),
    async edit(id, fact, category, approveAfter = false) {
      const text = fact.trim();
      if (text.length < 3) {
        notice("error", "A note must be at least 3 characters.");
        return false;
      }
      const ok = await act(id, () => client.edit(id, category ? { fact: text, category } : { fact: text }), () => (approveAfter ? "" : "Saved your change."));
      if (ok && approveAfter) return api.approve(id);
      return ok;
    },
    remove: (id) =>
      act(
        id,
        () => client.remove(id),
        (d) => {
          set({ undoMinutes: d.undoMinutes });
          return `Deleted. You can undo this for ${d.undoMinutes} minutes.`;
        },
      ),
    undo: (id) => act(id, () => client.decide(id, "undelete"), () => "Brought the note back."),
    revive: (id) => act(id, () => client.decide(id, "revive"), () => "Brought the note back."),
    async add(fact, category) {
      const text = fact.trim();
      if (text.length < 3) {
        notice("error", "A note must be at least 3 characters.");
        return false;
      }
      return act("add", () => client.add(text, category), (d) => (d.duplicate ? "You already have that note." : `Added.${pausedNote()}`));
    },
    setPaused: (paused) =>
      act(
        "settings",
        () => client.setSettings({ learningPaused: paused }),
        (d) => {
          set({ settings: d.settings });
          return paused ? "Learning is paused. Faye will not learn new notes, and she will not use your notes in answers." : "Learning is on again. Faye can suggest notes and use the ones you approved.";
        },
      ),
    setShowUsed: (show) =>
      act(
        "settings",
        () => client.setSettings({ showUsedNotes: show }),
        (d) => {
          set({ settings: d.settings });
          return show ? "Answers will show which notes were used." : "Answers will not show which notes were used.";
        },
      ),
    async exportAll() {
      let saved = true;
      let name = "";
      let count = 0;
      const ok = await act(
        "export",
        () => client.exportAll(),
        (f) => {
          saved = save(f);
          name = f.filename;
          count = f.count;
          return saved ? `Saved ${name} with ${count} ${count === 1 ? "note" : "notes"} in it.` : "";
        },
        { heavy: "export" },
      );
      if (ok && !saved) notice("error", "Your browser did not allow the download. Try again.");
      return ok && saved;
    },
    deleteAll: () => act("delete_all", () => client.deleteAll(), () => "Deleted all your notes and habit counts.", { heavy: "delete_all" }),
    erase: () => act("erase", () => client.erase(), () => "Erased all your data with Faye.", { heavy: "erase" }),
    clearReauth: () => set({ reauth: null }),
    notify: notice,
  };
  return api;
}

// ------------------------------------------------------------------------------------------------ the component

export interface AboutMeSummary {
  enabled: boolean;
  approved: number;
  proposed: number;
  paused: boolean;
  showUsedNotes: boolean;
}

export interface AboutMeProps {
  /** Default: the real client for this app's routes. Tests and previews pass a fake. */
  client?: MemoryClient;
  /** "Back to chat". */
  onClose: () => void;
  /** Called whenever the lists or settings change, so the chat can show a badge and the "notes are still here" line. */
  onSummary?: (s: AboutMeSummary) => void;
  /** Where "sign in again" goes. Default /login. */
  signInHref?: string;
  /** Test hook: replace the clock and the file saver. */
  now?: () => number;
  save?: (file: ExportFile) => boolean;
  /** Test and preview hook: hand the store out. */
  storeRef?: (s: AboutMeStore) => void;
}

const TICK_MS = 30_000;

export function summaryOf(s: AboutMeState): AboutMeSummary {
  return { enabled: s.enabled, approved: s.notes.length, proposed: s.proposals.length, paused: s.settings.learningPaused, showUsedNotes: s.settings.showUsedNotes };
}

export function AboutMe(props: AboutMeProps) {
  const { client: clientProp, now, save, onSummary, storeRef } = props;
  const client = useMemo(() => clientProp ?? createMemoryClient(), [clientProp]);
  const store = useMemo(() => createAboutMeStore({ client, now, save }), [client, now, save]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    storeRef?.(store);
    void store.load();
    const t = setInterval(() => store.tick(), TICK_MS);
    return () => clearInterval(t);
  }, [store, storeRef]);

  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;
  const last = useRef("");
  useEffect(() => {
    if (state.load !== "ready") return;
    const s = summaryOf(state);
    const key = JSON.stringify(s);
    if (key === last.current) return;
    last.current = key;
    summaryRef.current?.(s);
  }, [state]);

  return <AboutMeView state={state} store={store} onClose={props.onClose} signInHref={props.signInHref ?? "/login"} />;
}
