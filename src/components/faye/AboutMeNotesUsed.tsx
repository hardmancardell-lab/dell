"use client";

import { useRef, useState } from "react";
import type { MemoryClient } from "@/lib/faye/memory-client";

/**
 * The "Used N notes" line under an answer (design 3.5). Collapsed by default. Opening it asks About me for the notes and lists the
 * ones this answer used, as plain text, so the owner can see what shaped an answer and fix it. A note that has since been deleted
 * shows as a short line instead of its text.
 *
 * It only ever receives note ids (from the answer's provenance), never note text. The text comes from the owner's own list.
 */
export function NotesUsedLine(props: { count: number; ids: readonly string[]; client: MemoryClient | null; onOpenAboutMe?: () => void }) {
  const { count, ids, client } = props;
  const [state, setState] = useState<"closed" | "loading" | "ready" | "error">("closed");
  const [facts, setFacts] = useState<Record<string, string>>({});
  const asked = useRef(false);
  const label = `Used ${count} ${count === 1 ? "note" : "notes"}`;

  // Without a client, or with no ids to look up, there is nothing to open: show the plain count.
  if (!client || ids.length === 0) {
    return (
      <div className="fw-meta" data-testid="faye-notes-used">
        {label}
      </div>
    );
  }

  async function onToggle(open: boolean) {
    if (!open || asked.current || !client) return;
    asked.current = true;
    setState("loading");
    const r = await client.list();
    if (!r.ok) {
      asked.current = false;
      setState("error");
      return;
    }
    const map: Record<string, string> = {};
    for (const i of r.data.items) if (!i.deletedAt && ids.includes(i.id)) map[i.id] = i.fact;
    setFacts(map);
    setState("ready");
  }

  return (
    <details className="fw-notes" data-testid="faye-notes-used" onToggle={(e) => void onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{label}</summary>
      {state === "loading" ? <p className="fw-notes-line">Looking up your notes...</p> : null}
      {state === "error" ? <p className="fw-notes-line">I could not load your notes just now.</p> : null}
      {state === "ready" ? (
        <ul className="fw-notes-list" aria-label="Notes used in this answer">
          {ids.map((id) => (
            <li key={id}>{facts[id] ?? "A note that has been deleted or changed since."}</li>
          ))}
        </ul>
      ) : null}
      {props.onOpenAboutMe ? (
        <button type="button" className="fw-btn fw-notes-open" onClick={props.onOpenAboutMe}>
          Open About me
        </button>
      ) : null}
    </details>
  );
}
