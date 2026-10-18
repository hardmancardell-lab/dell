"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import {
  ASSET_CLASS_LABEL,
  ASSET_CLASSES,
  STUDIES,
  STUDY_CATEGORIES,
  describeNeeds,
  type AssetClass,
  type StudyCategory,
  type StudyEntry,
} from "@/lib/navigation/study-registry";
import { fuzzyRank } from "@/lib/navigation/fuzzy";

/**
 * The Study Library: every study in the Trading Agent, searchable and grouped by the question it answers.
 *
 * It replaces scanning a strip of 18 tabs. Each card says what the study answers, what it needs, roughly how long it takes
 * and which asset classes it applies to. The asset-class filter defaults to the current context (the group the user is in);
 * a group passes `lockedAssetClass` so the library shows only that group's studies.
 *
 * Styling uses the jarvis tokens and must render inside a .jarvis scope (page.tsx wraps it).
 */
export type AssetFilter = AssetClass | "all";

export interface StudyLibraryProps {
  assetClass: AssetFilter;
  onAssetClassChange?: (next: AssetFilter) => void;
  /** When set, the asset-class filter is hidden and fixed to this class (the group's Studies tab). */
  lockedAssetClass?: AssetClass;
  onOpen: (studyId: string, assetClass: AssetClass | undefined) => void;
  pins: string[];
  onTogglePin: (key: string) => void;
  /** Shown above the filters, for example "Equities". */
  scopeLabel?: string;
}

const TOUCH: React.CSSProperties = { minHeight: 44 };

function appliesTo(study: StudyEntry, filter: AssetFilter): boolean {
  if (filter === "all") return true;
  return study.assetClasses.includes(filter);
}

export function StudyLibrary({ assetClass, onAssetClassChange, lockedAssetClass, onOpen, pins, onTogglePin, scopeLabel }: StudyLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StudyCategory | "all">("all");
  const searchId = useId();
  const resultsId = useId();
  const filter: AssetFilter = lockedAssetClass ?? assetClass;

  const byAsset = useMemo(() => STUDIES.filter((s) => appliesTo(s, filter)), [filter]);
  const counts = useMemo(() => {
    const c = new Map<StudyCategory, number>();
    for (const s of byAsset) c.set(s.category, (c.get(s.category) ?? 0) + 1);
    return c;
  }, [byAsset]);

  const results = useMemo(() => {
    const inCategory = category === "all" ? byAsset : byAsset.filter((s) => s.category === category);
    return fuzzyRank(query, inCategory, (s) => [s.title, s.question, s.category, s.keywords ?? "", s.assetClasses.map((c) => ASSET_CLASS_LABEL[c]).join(" ")]);
  }, [byAsset, category, query]);

  const grouped = !query.trim();
  const sections: Array<{ heading: string | null; items: StudyEntry[] }> = grouped
    ? STUDY_CATEGORIES.map((c) => ({ heading: c as string, items: results.filter((s) => s.category === c) })).filter((g) => g.items.length > 0)
    : [{ heading: null, items: results }];

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  }

  const chipStyle = (on: boolean): React.CSSProperties => ({
    ...TOUCH,
    padding: "6px 14px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    border: `1px solid ${on ? "var(--signal)" : "var(--line-control)"}`,
    background: on ? "var(--signal)" : "transparent",
    color: on ? "var(--ink-950)" : "var(--text-1)",
    fontWeight: on ? 600 : 400,
  });

  return (
    <section aria-label={scopeLabel ? `Study Library: ${scopeLabel}` : "Study Library"}>
      <p className="jv-lede" style={{ marginBottom: 16 }}>
        Pick the question you want answered. Every study runs on real market data and says how much history it needs. Use the search
        box, or narrow by type{lockedAssetClass ? "" : " and asset class"}.
      </p>

      <div role="search" className="flex flex-col gap-3 mb-4">
        <div>
          <label htmlFor={searchId} className="jv-label">
            Search studies
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Try: gap, weekday, VWAP, backtest, volume"
            autoComplete="off"
            aria-controls={resultsId}
            className="jv-input w-full"
            style={{ ...TOUCH, fontSize: 16 }}
          />
        </div>

        <div>
          <div className="jv-label" id={`${searchId}-cat`}>
            Type of study
          </div>
          <div role="group" aria-labelledby={`${searchId}-cat`} className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} style={chipStyle(category === "all")}>
              All ({byAsset.length})
            </button>
            {STUDY_CATEGORIES.map((c) => {
              const n = counts.get(c) ?? 0;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  disabled={n === 0}
                  onClick={() => setCategory(c)}
                  style={{ ...chipStyle(category === c), opacity: n === 0 ? 0.4 : 1 }}
                >
                  {c} ({n})
                </button>
              );
            })}
          </div>
        </div>

        {!lockedAssetClass && onAssetClassChange && (
          <div>
            <div className="jv-label" id={`${searchId}-asset`}>
              Asset class
            </div>
            <div role="group" aria-labelledby={`${searchId}-asset`} className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={filter === "all"} onClick={() => onAssetClassChange("all")} style={chipStyle(filter === "all")}>
                All
              </button>
              {ASSET_CLASSES.map((c) => (
                <button key={c} type="button" aria-pressed={filter === c} onClick={() => onAssetClassChange(c)} style={chipStyle(filter === c)}>
                  {ASSET_CLASS_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p id={resultsId} role="status" aria-live="polite" className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        {results.length === 0
          ? "No studies match."
          : `${results.length} ${results.length === 1 ? "study" : "studies"}${query.trim() ? ` matching “${query.trim()}”` : ""}${
              filter !== "all" ? ` for ${ASSET_CLASS_LABEL[filter]}` : ""
            }`}
      </p>

      {results.length === 0 && (
        <div className="jv-card" style={{ maxWidth: 520 }}>
          <p className="text-sm mb-3" style={{ color: "var(--text-1)" }}>
            Nothing matches that. Try fewer words, or clear the filters to see everything.
          </p>
          <button
            type="button"
            className="jv-btn-outline"
            style={TOUCH}
            onClick={() => {
              setQuery("");
              setCategory("all");
              if (!lockedAssetClass && onAssetClassChange) onAssetClassChange("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {sections.map((sec) => (
        <div key={sec.heading ?? "results"} className="mb-6">
          {sec.heading && <h3 className="jv-strip-title">{sec.heading}</h3>}
          <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", listStyle: "none", padding: 0, margin: 0 }}>
            {sec.items.map((s) => (
              <StudyCard
                key={s.id}
                study={s}
                headingLevel={grouped ? 4 : 3}
                filter={filter}
                pinned={pins.includes(`study:${s.id}`)}
                onTogglePin={() => onTogglePin(`study:${s.id}`)}
                onOpen={() => onOpen(s.id, filter === "all" ? undefined : filter)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StudyCard({
  study,
  headingLevel,
  filter,
  pinned,
  onTogglePin,
  onOpen,
}: {
  study: StudyEntry;
  headingLevel: 3 | 4;
  filter: AssetFilter;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
}) {
  const planned = study.status === "planned";
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <li className="jv-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="jv-br-b" />
      <div className="flex items-start justify-between gap-2">
        <Heading className="text-sm font-medium" style={{ color: "var(--text-0)", margin: 0 }}>
          {study.title}
        </Heading>
        {study.tier === "intermediate" && (
          <span className="jv-badge c-neutral shrink-0" title="Unlocked by the Financial Literacy placement quiz">
            Intermediate
          </span>
        )}
      </div>
      <p className="text-sm" style={{ color: "var(--text-1)", margin: 0 }}>
        {study.question}
      </p>
      <dl className="text-xs" style={{ color: "var(--text-2)", margin: 0 }}>
        <div>
          <dt className="inline">Needs: </dt>
          <dd className="inline" style={{ margin: 0 }}>
            {describeNeeds(study.needs)}
          </dd>
        </div>
        <div>
          <dt className="inline">Takes: </dt>
          <dd className="inline" style={{ margin: 0 }}>
            {study.runTime}
          </dd>
        </div>
        <div>
          <dt className="inline">Applies to: </dt>
          <dd className="inline" style={{ margin: 0 }}>
            {study.assetClasses.length === 0
              ? "Any market"
              : study.assetClasses.map((c) => (
                  <span key={c} style={{ color: filter === c ? "var(--signal)" : undefined, fontWeight: filter === c ? 600 : undefined }}>
                    {ASSET_CLASS_LABEL[c]}
                    {c === study.assetClasses[study.assetClasses.length - 1] ? "" : ", "}
                  </span>
                ))}
          </dd>
        </div>
      </dl>
      <div className="flex items-center gap-2" style={{ marginTop: "auto" }}>
        <button
          type="button"
          className="jv-btn flex-1"
          style={TOUCH}
          onClick={onOpen}
          disabled={planned}
          aria-label={planned ? `${study.title} is coming soon` : `Open ${study.title}`}
        >
          {planned ? "Coming soon" : "Open"}
        </button>
        <button
          type="button"
          className="jv-btn-outline"
          style={{ ...TOUCH, minWidth: 44 }}
          aria-pressed={pinned}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${study.title}`}
          title={pinned ? "Unpin" : "Pin to the quick list"}
          onClick={onTogglePin}
        >
          <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
        </button>
      </div>
    </li>
  );
}
