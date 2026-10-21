"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CATEGORY_LABEL,
  MEMORY_CATEGORIES,
  SAFETY_WINDOW_MINUTES,
  SOURCE_LABEL,
  confidenceLabel,
  groupByCategory,
  undoLabel,
  undoSecondsLeft,
  type MemCategory,
  type MemItem,
} from "@/lib/faye/memory-client";
import type { AboutMeState, AboutMeStore, HeavyAction } from "./AboutMe";
import { ABOUT_ME_CSS } from "./AboutMeStyles";

/**
 * The About-me screen. Pure view: it draws `state` and calls `store`. Every note is drawn as a React text node, so a note that
 * contains markup shows as the characters it is made of, never as HTML. Nothing in this file sets HTML.
 *
 * Accessibility: one polite live region for results; headings in order (h2 title, h3 sections, h4 groups); every control has a
 * label; the confirm dialog traps focus, closes on Escape and gives focus back; touch targets are 44 px on phones.
 */

/** The fixed sentences. Grade 8 or lower (a test checks it). */
export const ABOUT_ME_COPY = {
  intro: "These are the short notes Faye keeps about you. She only uses a note after you approve it. You can change or delete any of them.",
  flagOff: {
    title: "Notes are not turned on for answers yet",
    body: "Faye is not learning new notes, and she does not use these in answers. You can still look at everything here, export it, or delete it.",
  },
  paused: {
    title: "Learning is paused",
    body: "Faye is not learning new notes, and she is not using your notes in answers.",
  },
  empty: {
    title: "No notes yet",
    body: "Faye has not saved anything about you. In the chat, you can type: remember that I like the number first.",
  },
  proposalsHint: "Faye suggests these from what you type. She will not use one until you approve it.",
  pauseTitle: "Pause learning",
  pauseBody: "While paused, Faye does not learn new notes. She also does not use your notes in answers.",
  showUsedTitle: "Show which notes were used",
  showUsedBody: "Under an answer, Faye shows how many notes she used, and you can open the list.",
  addTitle: "Add a note",
  addHint: "Write it in your own words. Short is best.",
  never: "Faye never keeps passwords, keys, card numbers or account numbers. Your chat messages are deleted after 24 hours. Only the short notes on this page are kept, until you delete them.",
  exportTitle: "Export my notes",
  exportBody: "Save everything Faye keeps about you as a file. You need to have signed in within the last 30 minutes.",
  deleteAllTitle: "Delete all my notes",
  deleteAllBody: "Remove every note and every habit count. Notes copied into your recent questions are cleared too. Your settings stay.",
  eraseTitle: "Erase all my data",
  eraseBody: "Remove your notes, your settings, your habit counts and your recent chats. Anything saved to train Faye goes too.",
  reauthTitle: "Please sign in again first",
  reauthBody: `For your safety, Faye needs a sign-in from the last ${SAFETY_WINDOW_MINUTES} minutes before she will export or delete everything. Sign in, come back here, and press the button once more.`,
  confirmDeleteAll: {
    title: "Delete all your notes?",
    body: "This removes every note and every habit count. Notes copied into your recent questions are cleared too. You cannot undo it.",
    button: "Delete all notes",
  },
  confirmErase: {
    title: "Erase all your data?",
    body: "This removes your notes, your settings, your habit counts and your recent chats. Anything saved to train Faye goes too. You cannot undo it.",
    button: "Erase all data",
  },
  typeDelete: "Type DELETE to confirm",
} as const;

const HEAVY_WORD: Record<HeavyAction, string> = { export: "export", delete_all: "delete", erase: "erase" };

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}...` : s);

function sectionKey(s: string) {
  return `[data-h="${s}"]`;
}

export interface AboutMeViewProps {
  state: AboutMeState;
  store: AboutMeStore;
  onClose: () => void;
  signInHref?: string;
}

interface Editing {
  id: string;
  text: string;
  category: MemCategory;
  proposal: boolean;
}

export function AboutMeView({ state, store, onClose, signInHref = "/login" }: AboutMeViewProps) {
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialog, setDialog] = useState<null | "delete_all" | "erase">(null);
  const [addText, setAddText] = useState("");
  const [addCat, setAddCat] = useState<"" | MemCategory>("");

  const busy = (k: string) => state.busy.includes(k);
  const anyHeavy = busy("export") || busy("delete_all") || busy("erase");
  const loaded = state.load === "ready";
  const live = state.enabled;
  const titleId = `${uid}-title`;

  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editingId) rootRef.current?.querySelector<HTMLElement>("[data-edit-area]")?.focus();
  }, [editingId]);

  /** Focus the first element that exists, after the next paint (the lists re-render first). */
  function focusFirst(...selectors: string[]) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        for (const sel of selectors) {
          const el = root.querySelector<HTMLElement>(sel);
          if (el) {
            el.focus();
            return;
          }
        }
      }),
    );
  }

  async function doApprove(id: string) {
    if (await store.approve(id)) focusFirst(sectionKey("proposals"), sectionKey("notes"), sectionKey("title"));
  }
  async function doReject(id: string) {
    if (await store.reject(id)) focusFirst(sectionKey("proposals"), sectionKey("title"));
  }
  async function doDelete(id: string) {
    if (await store.remove(id)) focusFirst(`[data-undo="${id}"]`, sectionKey("deleted"), sectionKey("title"));
  }
  async function doUndo(id: string) {
    if (await store.undo(id)) focusFirst(`[data-note="${id}"] [data-edit-btn]`, sectionKey("notes"), sectionKey("title"));
  }
  async function doRevive(id: string) {
    if (await store.revive(id)) focusFirst(`[data-note="${id}"] [data-edit-btn]`, sectionKey("notes"), sectionKey("title"));
  }
  async function saveEdit(approveAfter: boolean) {
    if (!editing) return;
    const e = editing;
    if (await store.edit(e.id, e.text, e.category, approveAfter)) {
      setEditing(null);
      focusFirst(`[data-note="${e.id}"] [data-edit-btn]`, sectionKey("notes"), sectionKey("proposals"), sectionKey("title"));
    } else {
      focusFirst("[data-edit-area]");
    }
  }
  function cancelEdit() {
    const id = editing?.id;
    setEditing(null);
    if (id) focusFirst(`[data-note="${id}"] [data-edit-btn]`, sectionKey("title"));
  }
  async function doAdd(e: React.FormEvent) {
    e.preventDefault();
    if (await store.add(addText, addCat || undefined)) {
      setAddText("");
      setAddCat("");
      focusFirst("[data-add-input]");
    }
  }
  async function doExport() {
    const ok = await store.exportAll();
    if (!ok) focusFirst("[data-reauth]", "[data-export-btn]");
  }
  async function confirmHeavy(kind: "delete_all" | "erase") {
    const ok = kind === "delete_all" ? await store.deleteAll() : await store.erase();
    setDialog(null);
    focusFirst(ok ? sectionKey("title") : "[data-reauth]");
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.stopPropagation(); // never let Escape here close the whole Faye window
    if (dialog) return; // the dialog handles its own Escape
    if (editing) cancelEdit();
    else onClose();
  }

  // ------------------------------------------------------------------ pieces

  const dateLabel = (s: MemItem) => {
    const bits: string[] = [SOURCE_LABEL[s.source], confidenceLabel(s.effectiveConfidence)];
    return bits.join(" · ");
  };

  function renderEditForm(item: MemItem) {
    if (!editing || editing.id !== item.id) return null;
    const areaId = `${uid}-edit-${item.id}`;
    const catId = `${uid}-cat-${item.id}`;
    const working = busy(item.id);
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveEdit(false);
        }}
      >
        <div className="fam-field">
          <label htmlFor={areaId}>Edit this note</label>
          <textarea
            id={areaId}
            data-edit-area
            className="fam-area"
            value={editing.text}
            maxLength={200}
            rows={3}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <span className="fam-count" aria-hidden="true">
            {editing.text.length}/200
          </span>
        </div>
        <div className="fam-field">
          <label htmlFor={catId}>Type of note</label>
          <select id={catId} className="fam-select" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as MemCategory })}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="fam-row" style={{ marginTop: 8 }}>
          <button type="submit" className="fam-btn fam-btn-primary" disabled={working || editing.text.trim().length < 3}>
            Save
          </button>
          {editing.proposal && live ? (
            <button type="button" className="fam-btn" disabled={working || editing.text.trim().length < 3} onClick={() => void saveEdit(true)}>
              Save and approve
            </button>
          ) : null}
          <button type="button" className="fam-btn" onClick={cancelEdit}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  function startEdit(item: MemItem) {
    setEditing({ id: item.id, text: item.fact, category: item.category, proposal: item.status === "proposed" });
  }

  function renderNote(item: MemItem, kind: "proposal" | "approved" | "faded" | "rejected") {
    const isEditing = editing?.id === item.id;
    const working = busy(item.id);
    const name = short(item.fact);
    return (
      <li key={item.id} className={`fam-note${kind === "proposal" ? " fam-note-prop" : ""}`} data-note={item.id}>
        {isEditing ? (
          renderEditForm(item)
        ) : (
          <>
            <p className="fam-fact">{item.fact}</p>
            <p className="fam-meta">
              {dateLabel(item)}
              {" · "}
              {kind === "proposal" ? <span data-flag>Waiting for your OK</span> : kind === "approved" ? "Approved" : kind === "faded" ? <span data-flag>Faded away</span> : "Rejected"}
              {kind === "approved" && item.faded ? (
                <>
                  {" · "}
                  <span data-flag>Fading</span>
                </>
              ) : null}
              {item.supersedes ? " · Replaces an older note" : ""}
              {item.useCount > 0 ? ` · Used ${item.useCount} ${item.useCount === 1 ? "time" : "times"}` : ""}
            </p>
            <div className="fam-row">
              {kind === "proposal" ? (
                <>
                  {live ? (
                    <button type="button" className="fam-btn fam-btn-primary" aria-label={`Approve: ${name}`} disabled={working} onClick={() => void doApprove(item.id)}>
                      Approve
                    </button>
                  ) : null}
                  {live ? (
                    <button type="button" className="fam-btn" data-edit-btn aria-label={`Edit: ${name}`} disabled={working} onClick={() => startEdit(item)}>
                      Edit
                    </button>
                  ) : null}
                  <button type="button" className="fam-btn" aria-label={`Reject: ${name}`} disabled={working} onClick={() => void doReject(item.id)}>
                    Reject
                  </button>
                </>
              ) : null}
              {kind === "approved" ? (
                <>
                  {live ? (
                    <button type="button" className="fam-btn" data-edit-btn aria-label={`Edit: ${name}`} disabled={working} onClick={() => startEdit(item)}>
                      Edit
                    </button>
                  ) : null}
                  <button type="button" className="fam-btn" aria-label={`Delete: ${name}`} disabled={working} onClick={() => void doDelete(item.id)}>
                    Delete
                  </button>
                </>
              ) : null}
              {kind === "faded" ? (
                <>
                  {live ? (
                    <button type="button" className="fam-btn" data-edit-btn aria-label={`Bring back: ${name}`} disabled={working} onClick={() => void doRevive(item.id)}>
                      Bring back
                    </button>
                  ) : null}
                  <button type="button" className="fam-btn" aria-label={`Delete: ${name}`} disabled={working} onClick={() => void doDelete(item.id)}>
                    Delete
                  </button>
                </>
              ) : null}
              {kind === "rejected" ? (
                <button type="button" className="fam-btn" aria-label={`Delete: ${name}`} disabled={working} onClick={() => void doDelete(item.id)}>
                  Delete
                </button>
              ) : null}
            </div>
          </>
        )}
      </li>
    );
  }

  function renderSwitch({ id, title, body, on, onToggle, disabled }: { id: string; title: string; body: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
    return (
      <div className="fam-switch">
        <div className="fam-switch-text">
          <b id={`${id}-l`}>{title}</b>
          <span id={`${id}-d`}>{body}</span>
          <span className="fam-tog-state" aria-hidden="true">
            {on ? "On" : "Off"}
          </span>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} className="fam-tog" disabled={disabled} onClick={onToggle}>
          <span className="fam-tog-track" aria-hidden="true" />
          <span className="fam-tog-knob" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const groups = groupByCategory(state.notes);
  const laterCount = state.faded.length + state.rejected.length;

  return (
    <section ref={rootRef} className="fam" aria-labelledby={titleId} data-faye-aboutme onKeyDown={onKeyDown}>
      <style href="faye-aboutme-v1" precedence="default">
        {ABOUT_ME_CSS}
      </style>

      <header className="fam-head" inert={dialog ? true : undefined}>
        <button type="button" className="fam-btn fam-back" onClick={onClose} aria-label="Back to the chat">
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <h2 className="fam-title" id={titleId} tabIndex={-1} data-h="title">
          About me
        </h2>
      </header>

      {/* The one polite live region for results. It is always in the page so a screen reader hears every change. */}
      <div className="fam-live" role="status" aria-live="polite" aria-atomic="true" data-testid="aboutme-live" data-tone={state.notice?.tone ?? "ok"}>
        {state.notice ? state.notice.text : ""}
      </div>

      <div className="fam-scroll" inert={dialog ? true : undefined}>
        <p className="fam-intro">{ABOUT_ME_COPY.intro}</p>

        {loaded && !live ? (
          <div className="fam-banner" data-testid="aboutme-flag-off">
            <strong>{ABOUT_ME_COPY.flagOff.title}</strong>
            <p>{ABOUT_ME_COPY.flagOff.body}</p>
          </div>
        ) : null}
        {loaded && live && state.settings.learningPaused ? (
          <div className="fam-banner" data-testid="aboutme-paused">
            <strong>{ABOUT_ME_COPY.paused.title}</strong>
            <p>{ABOUT_ME_COPY.paused.body}</p>
          </div>
        ) : null}

        {state.reauth ? (
          <div className="fam-banner fam-reauth" role="group" aria-labelledby={`${uid}-reauth`} tabIndex={-1} data-reauth data-testid="aboutme-reauth">
            <strong id={`${uid}-reauth`}>{ABOUT_ME_COPY.reauthTitle}</strong>
            <p>{ABOUT_ME_COPY.reauthBody}</p>
            <div className="fam-row">
              <a className="fam-btn fam-btn-primary" href={signInHref} target="_blank" rel="noopener noreferrer">
                Sign in again (opens a new tab)
              </a>
              <button type="button" className="fam-btn" onClick={() => store.clearReauth()}>
                Not now
              </button>
            </div>
            <p style={{ marginTop: 8 }} className="fam-hint">
              Then press &quot;{state.reauth === "export" ? ABOUT_ME_COPY.exportTitle : state.reauth === "delete_all" ? ABOUT_ME_COPY.deleteAllTitle : ABOUT_ME_COPY.eraseTitle}&quot; again to {HEAVY_WORD[state.reauth]}.
            </p>
          </div>
        ) : null}

        {state.load === "loading" || state.load === "idle" ? (
          <div className="fam-loading">
            Loading your notes...
          </div>
        ) : null}
        {state.load === "error" ? (
          <div className="fam-banner" data-testid="aboutme-load-error">
            <strong>Could not load your notes</strong>
            <p>{state.loadError}</p>
            <div className="fam-row" style={{ marginTop: 8 }}>
              <button type="button" className="fam-btn" onClick={() => void store.load()}>
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {loaded ? (
          <>
            {state.proposals.length > 0 ? (
              <div className="fam-sec">
                <h3 className="fam-h" tabIndex={-1} data-h="proposals">
                  Waiting for your OK <small>({state.proposals.length})</small>
                </h3>
                <p className="fam-hint">{ABOUT_ME_COPY.proposalsHint}</p>
                <ul className="fam-list">
                  {state.proposals.map((i) => renderNote(i, "proposal"))}
                </ul>
              </div>
            ) : null}

            <div className="fam-sec">
              <h3 className="fam-h" tabIndex={-1} data-h="notes">
                Your notes <small>({state.notes.length})</small>
              </h3>
              {groups.length === 0 ? (
                <div className="fam-empty" data-testid="aboutme-empty">
                  <p>
                    <b>{ABOUT_ME_COPY.empty.title}</b>
                  </p>
                  <p>{ABOUT_ME_COPY.empty.body}</p>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.category} className="fam-sec">
                    <h4 className="fam-sub">{CATEGORY_LABEL[g.category]}</h4>
                    <ul className="fam-list">
                      {g.items.map((i) => renderNote(i, "approved"))}
                    </ul>
                  </div>
                ))
              )}
            </div>

            {state.deleted.length > 0 ? (
              <div className="fam-sec">
                <h3 className="fam-h" tabIndex={-1} data-h="deleted">
                  Recently deleted <small>({state.deleted.length})</small>
                </h3>
                <ul className="fam-list">
                  {state.deleted.map((i) => (
                    <li key={i.id} className="fam-note" data-deleted={i.id}>
                      <p className="fam-fact">{i.fact}</p>
                      <p className="fam-meta">{undoLabel(undoSecondsLeft(i.deletedAt, state.undoMinutes, state.nowMs))}</p>
                      <div className="fam-row">
                        <button type="button" className="fam-btn fam-btn-primary" data-undo={i.id} aria-label={`Undo delete: ${short(i.fact)}`} disabled={busy(i.id)} onClick={() => void doUndo(i.id)}>
                          Undo
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {laterCount > 0 ? (
              <details className="fam-more">
                <summary>Faded and rejected notes ({laterCount})</summary>
                {state.faded.length > 0 ? (
                  <>
                    <h4 className="fam-sub">Faded away over time</h4>
                    <ul className="fam-list">
                      {state.faded.map((i) => renderNote(i, "faded"))}
                    </ul>
                  </>
                ) : null}
                {state.rejected.length > 0 ? (
                  <>
                    <h4 className="fam-sub">You rejected these</h4>
                    <ul className="fam-list">
                      {state.rejected.map((i) => renderNote(i, "rejected"))}
                    </ul>
                  </>
                ) : null}
              </details>
            ) : null}

            {live ? (
              <form className="fam-sec" onSubmit={(e) => void doAdd(e)} aria-labelledby={`${uid}-add`}>
                <h3 className="fam-h" id={`${uid}-add`}>
                  {ABOUT_ME_COPY.addTitle}
                </h3>
                <div className="fam-field">
                  <label htmlFor={`${uid}-add-text`}>A note about you</label>
                  <input id={`${uid}-add-text`} data-add-input className="fam-input" value={addText} maxLength={200} autoComplete="off" onChange={(e) => setAddText(e.target.value)} aria-describedby={`${uid}-add-hint`} />
                  <span id={`${uid}-add-hint`}>{ABOUT_ME_COPY.addHint}</span>
                </div>
                <div className="fam-field">
                  <label htmlFor={`${uid}-add-cat`}>Type of note</label>
                  <select id={`${uid}-add-cat`} className="fam-select" value={addCat} onChange={(e) => setAddCat(e.target.value as "" | MemCategory)}>
                    <option value="">Let Faye choose</option>
                    {MEMORY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fam-row">
                  <button type="submit" className="fam-btn fam-btn-primary" disabled={busy("add") || addText.trim().length < 3}>
                    Add note
                  </button>
                </div>
              </form>
            ) : null}

            <div className="fam-sec">
              <h3 className="fam-h">Settings</h3>
              {renderSwitch({
                id: `${uid}-pause`,
                title: ABOUT_ME_COPY.pauseTitle,
                body: ABOUT_ME_COPY.pauseBody,
                on: state.settings.learningPaused,
                disabled: busy("settings"),
                onToggle: () => void store.setPaused(!state.settings.learningPaused),
              })}
              {renderSwitch({
                id: `${uid}-used`,
                title: ABOUT_ME_COPY.showUsedTitle,
                body: ABOUT_ME_COPY.showUsedBody,
                on: state.settings.showUsedNotes,
                disabled: busy("settings"),
                onToggle: () => void store.setShowUsed(!state.settings.showUsedNotes),
              })}
            </div>

            <div className="fam-sec">
              <h3 className="fam-h">Your data</h3>
              <div className="fam-data">
                <div className="fam-data-item">
                  <b>{ABOUT_ME_COPY.exportTitle}</b>
                  <p>{ABOUT_ME_COPY.exportBody}</p>
                  <button type="button" className="fam-btn" data-export-btn disabled={anyHeavy} onClick={() => void doExport()}>
                    {busy("export") ? "Exporting..." : "Export"}
                  </button>
                </div>
                <div className="fam-data-item">
                  <b>{ABOUT_ME_COPY.deleteAllTitle}</b>
                  <p>{ABOUT_ME_COPY.deleteAllBody}</p>
                  <button type="button" className="fam-btn fam-btn-danger" data-delete-all-btn disabled={anyHeavy} onClick={() => setDialog("delete_all")}>
                    Delete all notes
                  </button>
                </div>
                <div className="fam-data-item">
                  <b>{ABOUT_ME_COPY.eraseTitle}</b>
                  <p>{ABOUT_ME_COPY.eraseBody}</p>
                  <button type="button" className="fam-btn fam-btn-danger" data-erase-btn disabled={anyHeavy} onClick={() => setDialog("erase")}>
                    Erase all data
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <p className="fam-quiet" data-testid="aboutme-never">
          {ABOUT_ME_COPY.never}
        </p>
      </div>

      {dialog ? (
        <ConfirmDialog
          title={dialog === "delete_all" ? ABOUT_ME_COPY.confirmDeleteAll.title : ABOUT_ME_COPY.confirmErase.title}
          body={dialog === "delete_all" ? ABOUT_ME_COPY.confirmDeleteAll.body : ABOUT_ME_COPY.confirmErase.body}
          confirmLabel={dialog === "delete_all" ? ABOUT_ME_COPY.confirmDeleteAll.button : ABOUT_ME_COPY.confirmErase.button}
          working={busy(dialog)}
          onCancel={() => {
            const opener = dialog === "delete_all" ? "[data-delete-all-btn]" : "[data-erase-btn]";
            setDialog(null);
            focusFirst(opener, sectionKey("title"));
          }}
          onConfirm={() => void confirmHeavy(dialog)}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ the confirm dialog

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function ConfirmDialog(props: { title: string; body: ReactNode; confirmLabel: string; working: boolean; onConfirm: () => void; onCancel: () => void }) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const ok = typed === "DELETE";

  // Focus goes to the DELETE field. (The caller gives focus back to the button that opened the dialog: by the time this runs the page
  // behind is inert, so document.activeElement can no longer tell us which button that was.)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input")?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!props.working) props.onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fam-scrim" onKeyDown={onKeyDown}>
      <div ref={ref} className="fam-dialog" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-b`} data-testid="aboutme-confirm">
        <h3 id={`${uid}-t`}>{props.title}</h3>
        <p id={`${uid}-b`}>{props.body}</p>
        <div className="fam-field">
          <label htmlFor={`${uid}-i`}>{ABOUT_ME_COPY.typeDelete}</label>
          <input id={`${uid}-i`} className="fam-input" value={typed} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <div className="fam-row">
          <button type="button" className="fam-btn fam-btn-danger-solid" disabled={!ok || props.working} onClick={props.onConfirm}>
            {props.working ? "Working..." : props.confirmLabel}
          </button>
          <button type="button" className="fam-btn" disabled={props.working} onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
