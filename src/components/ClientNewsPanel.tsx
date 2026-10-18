"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchlistNewsSection } from "@/lib/news/news-hub";
import { EmptyOrError, NewsList, NotAdviceNote, readNewsError, SectionFooter, SourceList } from "./NewsParts";

/**
 * Headlines for the symbols one client holds, shown in the client portal.
 *
 * Mount it inside the signed-in client view: <ClientNewsPanel slug={slug} />. It calls /api/client/[slug]/news, which checks
 * the client's passcode cookie itself. It shows symbols, headlines and links only, with no quantities or values.
 *
 * Imported by the Client Research agent's ClientDashboardView (that file is not edited here).
 */

type State =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "error"; message: string }
  | { status: "done"; data: WatchlistNewsSection & { holdingsCount: number; leftOut: number } };

export function ClientNewsPanel({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const started = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/client/${encodeURIComponent(slug)}/news`);
      if (res.status === 401) {
        setState({ status: "locked" });
        return;
      }
      if (!res.ok) {
        setState({ status: "error", message: await readNewsError(res) });
        return;
      }
      setState({ status: "done", data: await res.json() });
    } catch {
      setState({ status: "error", message: "The network did not answer. Check your connection and try again." });
    }
  }, [slug]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  return (
    <div className="jarvis">
      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>News on what you hold</h3>
          <button className="jv-btn-outline shrink-0" onClick={() => void load()} disabled={state.status === "loading"}>
            {state.status === "loading" ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Recent headlines for the investments on your account, with a link to the original page. We show only the headline, never the article.
        </p>

        {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading headlines{"…"}</p>}
        {state.status === "locked" && <EmptyOrError tone="error" message="Enter your passcode again to see the news." />}
        {state.status === "error" && <EmptyOrError tone="error" message={state.message} />}
        {state.status === "done" && (
          <>
            {state.data.error ? (
              <EmptyOrError tone="empty" message={state.data.error} />
            ) : (
              <div className="flex flex-col gap-4">
                {state.data.groups.map((g) => (
                  <div key={`${g.symbol}|${g.assetClass}`}>
                    <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>{g.symbol}</div>
                    {g.items.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--text-2)" }}>{g.note ?? "No recent headlines."}</p>
                    ) : (
                      <NewsList items={g.items} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {state.data.leftOut > 0 && (
              <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
                {state.data.leftOut} holding{state.data.leftOut === 1 ? " has" : "s have"} no news source (for example bonds), so nothing is shown for {state.data.leftOut === 1 ? "it" : "them"}.
              </p>
            )}
            <SourceList sources={state.data.sources} />
            <SectionFooter section={state.data} />
          </>
        )}
        {state.status !== "done" && <div className="mt-3"><NotAdviceNote /></div>}
      </div>
    </div>
  );
}
