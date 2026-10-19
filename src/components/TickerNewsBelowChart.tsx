"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import type { TickerNewsGroups } from "@/lib/news/news-core";
import { EmptyOrError, NotAdviceNote, readNewsError, TickerNewsGroupsView } from "./NewsParts";

/**
 * News under a chart, for one symbol. Two labelled groups: "About this asset" and "Market and macro".
 *
 * Mount it directly below the chart and pass the same symbol and asset class the chart uses:
 *   <TickerNewsBelowChart symbol={symbol} assetClass={assetClass} />
 * It fetches once when the symbol or the asset class changes and never on a chart tick, a timeframe change or a re-render.
 * It calls /api/news-hub?section=ticker, which needs the same signed-in session as the rest of the app.
 * It does not open its own .jarvis island: every chart it sits under is already inside one.
 *
 * News impact slot: the News impact panel (src/components/NewsImpactPanel.tsx) is built by another agent. When it exists,
 * pass it in through the impactSlot prop (for example impactSlot={<NewsImpactPanel symbol={symbol} assetClass={assetClass} />})
 * and it renders between the heading and the two news groups. Nothing here depends on it.
 */

type Settled = { status: "error"; message: string } | { status: "done"; data: TickerNewsGroups };
type State = { status: "loading" } | Settled;

export function TickerNewsBelowChart({ symbol, assetClass, impactSlot, limit = 5 }: { symbol: string; assetClass: AssetClass; impactSlot?: ReactNode; limit?: number }) {
  const clean = symbol.trim();
  const key = `${clean}|${assetClass}`;
  // The answer is stored with the key it was fetched for. While the stored key is not the current one, the view is loading.
  const [settled, setSettled] = useState<{ key: string; value: Settled } | null>(null);
  const state: State = settled && settled.key === key ? settled.value : { status: "loading" };

  // The only dependencies are the symbol and the class, so a chart tick (which does not change either) never refetches.
  useEffect(() => {
    if (!clean) return;
    let cancelled = false;
    (async () => {
      let value: Settled;
      try {
        const res = await fetch(`/api/news-hub?section=ticker&ticker=${encodeURIComponent(clean)}&assetClass=${encodeURIComponent(assetClass)}`);
        value = res.ok ? { status: "done", data: (await res.json()) as TickerNewsGroups } : { status: "error", message: await readNewsError(res) };
      } catch {
        value = { status: "error", message: "The network did not answer. Check your connection and try again." };
      }
      if (!cancelled) setSettled({ key: `${clean}|${assetClass}`, value });
    })();
    return () => {
      cancelled = true;
    };
  }, [clean, assetClass]);

  if (!clean) return null;

  const empty = state.status === "done" && state.data.about.items.length === 0 && state.data.macro.items.length === 0;

  return (
    <div className="mt-4" data-testid="ticker-news-below-chart">
      <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-0)" }}>
        News for {clean}
        {state.status === "done" && <span className="text-xs font-normal ml-2" style={{ color: "var(--text-2)" }}>{state.data.topic}</span>}
      </h2>

      {/* NEWS IMPACT SLOT: the News impact panel (another agent's NewsImpactPanel) is passed in here through the impactSlot prop. */}
      {impactSlot && <div data-slot="news-impact" className="mb-3">{impactSlot}</div>}

      {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }} role="status">Loading news{"…"}</p>}
      {state.status === "error" && <EmptyOrError tone="error" message={state.message} />}
      {empty && <EmptyOrError tone="empty" message={`No headlines came back for ${clean} right now. That can mean a quiet day or sources that are off.`} />}
      {state.status === "done" && <TickerNewsGroupsView data={state.data} limit={limit} />}
      {(state.status === "loading" || state.status === "error") && (
        <div className="mt-3">
          <NotAdviceNote />
        </div>
      )}
    </div>
  );
}
