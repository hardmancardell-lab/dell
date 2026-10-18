"use client";

import { useEffect, useRef, useState } from "react";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import { ASSET_CLASS_LABEL, getStudy, type AssetClass } from "@/lib/navigation/study-registry";
import type { AssetGroup } from "@/lib/navigation/trading-structure";
import { isAssetClass } from "@/lib/navigation/study-routes";
import { StudyLibrary, type AssetFilter } from "./StudyLibrary";
import { StudyBody } from "./study-components";
import { useStudyPrefs } from "./use-study-prefs";

/**
 * Library or open study, in one place. Used by the first-class Studies tab (no group) and by each asset-class group's
 * Studies tab (`group` set, asset class fixed). What is open lives in the navigation state, so it is in the URL,
 * survives reload and works with Back and Forward.
 */
export function StudyWorkspace({ group }: { group?: AssetGroup }) {
  const nav = useAppNavigation();
  const { prefs, togglePin, pushRecent } = useStudyPrefs();
  const hostId = group ? group.id : "studies";
  const active = nav.state.primaryId === "trading" && nav.state.secondaryId === hostId;
  const study = active ? getStudy(nav.state.studyId) : undefined;
  const ticker = active ? nav.state.ticker : undefined;
  const stateClass = isAssetClass(nav.state.assetClass) ? nav.state.assetClass : undefined;
  const [filter, setFilter] = useState<AssetFilter>(group?.assetClass ?? stateClass ?? nav.lastAssetClass ?? "all");
  const topRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);

  const assetClass: AssetClass | undefined = group
    ? group.assetClass
    : study && stateClass && study.assetClasses.includes(stateClass)
      ? stateClass
      : study?.assetClasses[0];

  // Record the study as a recent, and move focus to its heading so a keyboard or screen-reader user lands in context.
  useEffect(() => {
    if (!study) {
      if (opened.current) topRef.current?.focus();
      opened.current = false;
      return;
    }
    pushRecent(`study:${study.id}`);
    if (opened.current || document.activeElement === document.body || topRef.current?.contains(document.activeElement)) headingRef.current?.focus();
    opened.current = true;
  }, [study?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(studyId: string, cls: AssetClass | undefined) {
    if (group) nav.patch({ tab: "studies", studyId, ticker: undefined });
    else nav.patch({ studyId, assetClass: cls, ticker: undefined });
  }
  function close() {
    nav.patch({ studyId: undefined, ticker: undefined, ...(group ? {} : { assetClass: undefined }) });
  }

  if (!study) {
    return (
      <div ref={topRef} tabIndex={-1} style={{ outline: "none" }}>
        <StudyLibrary
          assetClass={filter}
          onAssetClassChange={group ? undefined : setFilter}
          lockedAssetClass={group?.assetClass}
          scopeLabel={group?.label}
          onOpen={open}
          pins={prefs.pins}
          onTogglePin={togglePin}
        />
      </div>
    );
  }

  const pinKey = `study:${study.id}`;
  const pinned = prefs.pins.includes(pinKey);
  return (
    <div ref={topRef} tabIndex={-1} style={{ outline: "none" }}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button type="button" className="jv-btn-outline" style={{ minHeight: 44 }} onClick={close}>
          <span aria-hidden="true">←</span> {group ? `All ${group.label} studies` : "All studies"}
        </button>
        <button
          type="button"
          className="jv-btn-outline"
          style={{ minHeight: 44 }}
          aria-pressed={pinned}
          onClick={() => togglePin(pinKey)}
        >
          <span aria-hidden="true">{pinned ? "★" : "☆"}</span> {pinned ? "Pinned" : "Pin this study"}
        </button>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="jv-title" style={{ fontSize: 20, marginBottom: 6, outline: "none" }}>
        {study.title}
      </h2>
      <p className="jv-lede" style={{ marginBottom: 12 }}>
        {study.question}
      </p>
      {!group && study.assetClasses.length > 1 && (
        <div className="mb-4">
          <div className="jv-label" id="study-class-label">
            Run it on
          </div>
          <div role="group" aria-labelledby="study-class-label" className="flex flex-wrap gap-2">
            {study.assetClasses.map((c) => {
              const on = c === assetClass;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => nav.patch({ assetClass: c, ticker: undefined })}
                  style={{
                    minHeight: 44,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    border: `1px solid ${on ? "var(--signal)" : "var(--line-control)"}`,
                    background: on ? "var(--signal)" : "transparent",
                    color: on ? "var(--ink-950)" : "var(--text-1)",
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {ASSET_CLASS_LABEL[c]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <StudyBody studyId={study.id} assetClass={assetClass} ticker={ticker} />
    </div>
  );
}
