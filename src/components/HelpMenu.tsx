"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { HELP_VIDEOS, type HelpVideo } from "@/lib/agents/help-videos";
import { useTrackEvent } from "@/lib/analytics/use-track";

/**
 * One shared help menu, reused across every agent (same "one component,
 * parameterized" pattern as AssetChartsTab/OrbDetailTab elsewhere in this
 * app) rather than five near-identical inline video blocks. Opens to this
 * agent's own video by default — so it's still immediately relevant to
 * whatever the user is looking at — but also lets you browse every other
 * agent's walkthrough from the same panel.
 *
 * Styled with the jarvis tokens (it used to be plain zinc/dark: variants). It is a real modal dialog now:
 * labelled, focus moves in on open and back to the Help button on close, Tab stays inside, Escape closes.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, video[controls], iframe, [tabindex]:not([tabindex="-1"])';

export function HelpMenu({ agentId }: { agentId: HelpVideo["agentId"] }) {
  const [open, setOpen] = useState(false);
  const defaultVideo = HELP_VIDEOS.find((v) => v.agentId === agentId) ?? null;
  const [activeId, setActiveId] = useState<string | null>(defaultVideo?.id ?? null);
  const { track } = useTrackEvent();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const active = HELP_VIDEOS.find((v) => v.id === activeId) ?? null;

  function openMenu() {
    setActiveId(defaultVideo?.id ?? HELP_VIDEOS[0]?.id ?? null);
    setOpen(true);
    track("help_menu_opened", { tab: "Help", metadata: { agentId } });
  }

  function closeMenu() {
    setOpen(false);
  }

  function selectVideo(video: HelpVideo) {
    setActiveId(video.id);
    track("help_menu_video_selected", { tab: "Help", metadata: { agentId, selectedVideoId: video.id } });
  }

  // Move focus into the dialog when it opens and back to the trigger when it closes.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, [open]);

  function onDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="jarvis" style={{ display: "inline-block", padding: 0, background: "none", borderRadius: 0 }}>
      <button ref={triggerRef} type="button" onClick={openMenu} aria-haspopup="dialog" className="jv-btn-outline shrink-0" style={{ borderRadius: 9999 }}>
        <span aria-hidden="true">?</span> Help
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={closeMenu}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
            style={{
              maxWidth: 720,
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background: "var(--ink-900)",
              border: "1px solid var(--line-bright)",
              borderRadius: 8,
              color: "var(--text-0)",
              outline: "none",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
              <h2 id={titleId} className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>Help &amp; Walkthroughs</h2>
              <button type="button" onClick={closeMenu} className="jv-btn-outline">
                Close ✕
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4" style={{ overflowY: "auto" }}>
              {active ? (
                <div className="overflow-hidden" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
                  <div className="aspect-video" style={{ background: "var(--ink-950)" }}>
                    {active.kind === "mp4" ? (
                      <video controls preload="metadata" poster={active.poster} className="w-full h-full" src={active.src}>
                        Your browser does not support embedded video.
                      </video>
                    ) : (
                      <iframe
                        className="w-full h-full"
                        src={active.src}
                        title={active.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    )}
                  </div>
                  <div className="px-4 py-2 text-xs" style={{ color: "var(--text-1)", borderTop: "1px solid var(--line)" }}>{active.description}</div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-1)" }}>No walkthrough video for this section yet — browse the others below.</p>
              )}

              <div>
                <div className="jv-label">All Walkthroughs</div>
                <div className="flex flex-col gap-1.5">
                  {HELP_VIDEOS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => selectVideo(v)}
                      aria-pressed={v.id === activeId}
                      className="text-left px-3 py-2 text-sm"
                      style={{
                        borderRadius: 6,
                        border: `1px solid ${v.id === activeId ? "var(--signal)" : "var(--line-control)"}`,
                        background: v.id === activeId ? "var(--ink-800)" : "transparent",
                        color: "var(--text-0)",
                      }}
                    >
                      <div className="font-medium">{v.title}</div>
                      <div className="text-xs" style={{ color: "var(--text-1)" }}>{v.agentLabel}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
