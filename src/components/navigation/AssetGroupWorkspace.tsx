"use client";

import { useMemo } from "react";
import { Tabs } from "@/components/Tabs";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import { getStudy, studiesForAssetClass } from "@/lib/navigation/study-registry";
import { groupById } from "@/lib/navigation/trading-structure";
import { resolveStudyRoute } from "@/lib/navigation/study-routes";
import { StudyBody } from "./study-components";
import { StudyWorkspace } from "./StudyWorkspace";
import { TickerChartView } from "./TickerChartView";
import { useStudyPrefs } from "./use-study-prefs";

/**
 * One asset-class group of the Trading Agent (Equities, Bonds, ...), replacing the old strip of up to 18 tabs:
 *   - a small row of pinned and recently used studies for this group,
 *   - the group's direct tabs (Charts is the default where the group has one, then Dashboard or the group's main views),
 *   - a Studies tab that opens the Study Library filtered to this group's asset class.
 * Every study that used to be a tab of the group is in the library (see study-registry.ts and the reachability test).
 * Must render inside a .jarvis scope (page.tsx wraps it).
 */
export function AssetGroupWorkspace({ groupId }: { groupId: string }) {
  const group = groupById(groupId);
  const nav = useAppNavigation();
  const { prefs } = useStudyPrefs();

  const quick = useMemo(() => {
    if (!group) return { pinned: [] as string[], recent: [] as string[] };
    const applicable = new Set(studiesForAssetClass(group.assetClass).map((s) => s.id));
    const ids = (keys: string[]) => keys.filter((k) => k.startsWith("study:")).map((k) => k.slice(6)).filter((id) => applicable.has(id));
    const pinned = ids(prefs.pins);
    const recent = ids(prefs.recents).filter((id) => !pinned.includes(id)).slice(0, 5);
    return { pinned, recent };
  }, [group, prefs.pins, prefs.recents]);

  if (!group) return null;
  const active = nav.state.primaryId === "trading" && nav.state.secondaryId === group.id;
  const ticker = active ? nav.state.ticker : undefined;

  function openChip(id: string) {
    const route = resolveStudyRoute(id, group!.assetClass);
    if (route) nav.navigate(route);
  }

  const direct = group.directTabs.map((d) => ({
    id: d.studyId,
    label: d.label,
    content:
      d.studyId === "charts" && ticker ? (
        <TickerChartView symbol={ticker} assetClass={group.assetClass} />
      ) : (
        <StudyBody studyId={d.studyId} assetClass={group.assetClass} />
      ),
  }));

  const chip = (id: string, pinned: boolean) => {
    const s = getStudy(id);
    if (!s) return null;
    return (
      <li key={id}>
        <button
          type="button"
          onClick={() => openChip(id)}
          className="jv-btn-outline"
          style={{ minHeight: 44, borderRadius: 9999, padding: "4px 14px" }}
          title={s.question}
        >
          {pinned && <span aria-hidden="true">★ </span>}
          {s.title}
          {pinned && <span className="sr-only"> (pinned)</span>}
        </button>
      </li>
    );
  };

  return (
    <div>
      {(quick.pinned.length > 0 || quick.recent.length > 0) && (
        <nav aria-label={`Pinned and recent ${group.label} studies`} className="mb-4">
          <ul className="flex flex-wrap items-center gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li className="jv-label" style={{ marginBottom: 0 }}>
              {quick.pinned.length > 0 ? "Quick access" : "Recent"}
            </li>
            {quick.pinned.map((id) => chip(id, true))}
            {quick.recent.map((id) => chip(id, false))}
          </ul>
        </nav>
      )}
      <Tabs
        size="tertiary"
        theme="jarvis"
        navLevel="tertiary"
        navParentId={group.id}
        ariaLabel={`${group.label} views`}
        tabs={[...direct, { id: "studies", label: "Studies", content: <StudyWorkspace group={group} /> }]}
      />
    </div>
  );
}
