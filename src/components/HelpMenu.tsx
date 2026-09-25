"use client";

import { useState } from "react";
import { HELP_VIDEOS, type HelpVideo } from "@/lib/agents/help-videos";
import { useTrackEvent } from "@/lib/analytics/use-track";

/**
 * One shared help menu, reused across every agent (same "one component,
 * parameterized" pattern as AssetChartsTab/OrbDetailTab elsewhere in this
 * app) rather than five near-identical inline video blocks. Opens to this
 * agent's own video by default — so it's still immediately relevant to
 * whatever the user is looking at — but also lets you browse every other
 * agent's walkthrough from the same panel.
 */
export function HelpMenu({ agentId }: { agentId: HelpVideo["agentId"] }) {
  const [open, setOpen] = useState(false);
  const defaultVideo = HELP_VIDEOS.find((v) => v.agentId === agentId) ?? null;
  const [activeId, setActiveId] = useState<string | null>(defaultVideo?.id ?? null);
  const { track } = useTrackEvent();

  const active = HELP_VIDEOS.find((v) => v.id === activeId) ?? null;

  function openMenu() {
    setActiveId(defaultVideo?.id ?? HELP_VIDEOS[0]?.id ?? null);
    setOpen(true);
    track("help_menu_opened", { tab: "Help", metadata: { agentId } });
  }

  function selectVideo(video: HelpVideo) {
    setActiveId(video.id);
    track("help_menu_video_selected", { tab: "Help", metadata: { agentId, selectedVideoId: video.id } });
  }

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
      >
        <span aria-hidden="true">?</span> Help
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
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
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800"
            style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Help &amp; Walkthroughs</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 text-sm"
              >
                Close ✕
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4" style={{ overflowY: "auto" }}>
              {active ? (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="aspect-video bg-black">
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
                  <div className="px-4 py-2 text-xs text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">{active.description}</div>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No walkthrough video for this section yet — browse the others below.</p>
              )}

              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium mb-2">All Walkthroughs</div>
                <div className="flex flex-col gap-1.5">
                  {HELP_VIDEOS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => selectVideo(v)}
                      className={`text-left rounded-md border px-3 py-2 text-sm ${
                        v.id === activeId
                          ? "border-zinc-900 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-900"
                          : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{v.title}</div>
                      <div className="text-xs text-zinc-500">{v.agentLabel}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
