"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { isHubSymbol, type NewsSection, type TrendingTopic } from "@/lib/news/news-core";
import type { MarketNewsSection, WatchlistNewsSection } from "@/lib/news/news-hub";
import { EmptyOrError, NewsList, NotAdviceNote, readNewsError, SectionFooter, SourceList } from "./NewsParts";

/**
 * The News hub: market headlines, news for one ticker, and news for the watchlist, in one place.
 *
 * Register it as a tab (agent E owns the navigation files): import { NewsHubTab } from "@/components/NewsHubTab" and
 * render <NewsHubTab />. It needs the WatchlistProvider that src/app/layout.tsx already supplies.
 *
 * Every line shows the outlet, a time that says what it means, and a link to the original page. Only headlines and links
 * are shown, never article text.
 */

type View = "market" | "ticker" | "watchlist";

const VIEWS: { id: View; label: string }[] = [
  { id: "market", label: "Market headlines" },
  { id: "ticker", label: "One ticker" },
  { id: "watchlist", label: "My watchlist" },
];

const TICKER_ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "equity", label: "Stock or fund" },
  { value: "crypto", label: "Crypto" },
  { value: "forex", label: "Currency pair" },
  { value: "future", label: "Future" },
  { value: "commodity", label: "Commodity" },
];

type Load<T> = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; data: T };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("The network did not answer. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(await readNewsError(res));
  return (await res.json()) as T;
}

function TrendingCard({ topics }: { topics: TrendingTopic[] }) {
  return (
    <div className="jv-card mb-4">
      <div className="jv-br-b" />
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>
        What&apos;s moving in the news
      </h3>
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        These are words that show up in headlines from 3 or more outlets right now. This counts headlines. It does not tell you why a
        price moved, or that one did.
      </p>
      {topics.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-1)" }}>
          No topic is showing up across 3 or more outlets right now. That is normal on a quiet day.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {topics.map((t) => (
            <li key={t.term} className="text-sm">
              <span className="font-semibold" style={{ color: "var(--text-0)" }}>
                {t.term}
              </span>
              <span className="text-xs ml-2" style={{ color: "var(--text-2)" }}>
                in {t.headlines} headline{t.headlines === 1 ? "" : "s"} from {t.outlets} outlets
              </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {t.examples.map((e) => (
                  <li key={e.url} className="text-xs">
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-1)" }}>
                      {e.title}
                    </a>
                    <span style={{ color: "var(--text-2)" }}> {"—"} {e.source}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MarketView() {
  const [state, setState] = useState<Load<MarketNewsSection>>({ status: "idle" });
  const started = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await getJson<MarketNewsSection>("/api/news-hub?section=market") });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "News could not be loaded." });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Top stories from public business news feeds, newest first. The same story from several outlets is shown once.
        </p>
        <button className="jv-btn-outline shrink-0" onClick={() => void load()} disabled={state.status === "loading"}>
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>
      {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading headlines{"…"}</p>}
      {state.status === "error" && <EmptyOrError tone="error" message={state.message} />}
      {state.status === "done" && (
        <>
          {state.data.error ? (
            <EmptyOrError tone="error" message={state.data.error} />
          ) : (
            <>
              <TrendingCard topics={state.data.trending} />
              <div className="jv-card">
                <div className="jv-br-b" />
                <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-0)" }}>
                  Latest headlines ({state.data.items.length})
                </h3>
                <NewsList items={state.data.items} />
              </div>
            </>
          )}
          <SourceList sources={state.data.sources} />
          <SectionFooter section={state.data} />
        </>
      )}
      {(state.status === "idle" || state.status === "loading" || state.status === "error") && (
        <div className="mt-4">
          <NotAdviceNote />
        </div>
      )}
    </div>
  );
}

function TickerView() {
  const [input, setInput] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity");
  const [asked, setAsked] = useState<{ ticker: string; assetClass: AssetClass } | null>(null);
  const [state, setState] = useState<Load<NewsSection>>({ status: "idle" });
  const [inputError, setInputError] = useState<string | null>(null);
  const [background, setBackground] = useState<Load<NewsSection>>({ status: "idle" });

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!isHubSymbol(ticker)) {
      setInputError("Type a ticker using letters and numbers, like AAPL or EUR/USD.");
      return;
    }
    setInputError(null);
    setAsked({ ticker, assetClass });
    setBackground({ status: "idle" });
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await getJson<NewsSection>(`/api/news-hub?section=ticker&ticker=${encodeURIComponent(ticker)}&assetClass=${assetClass}`) });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "News could not be loaded." });
    }
  }

  async function loadBackground() {
    if (!asked) return;
    setBackground({ status: "loading" });
    try {
      setBackground({
        status: "done",
        data: await getJson<NewsSection>(`/api/news-hub?section=ticker&ticker=${encodeURIComponent(asked.ticker)}&assetClass=${asked.assetClass}&background=1`),
      });
    } catch (err) {
      setBackground({ status: "error", message: err instanceof Error ? err.message : "News could not be loaded." });
    }
  }

  const bgItems = background.status === "done" ? background.data.items.filter((i) => i.provider === "GDELT") : [];

  return (
    <div>
      <form onSubmit={search} className="flex flex-wrap gap-2 mb-1">
        <label className="sr-only" htmlFor="news-hub-ticker">Ticker</label>
        <input
          id="news-hub-ticker"
          className="jv-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker, like AAPL"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
        />
        <label className="sr-only" htmlFor="news-hub-class">Type</label>
        <select id="news-hub-class" className="jv-select" value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
          {TICKER_ASSET_CLASSES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button type="submit" className="jv-btn" disabled={state.status === "loading"}>
          {state.status === "loading" ? "Loading…" : "Get news"}
        </button>
      </form>
      {inputError && <p role="alert" className="text-xs mb-2" style={{ color: "var(--danger)" }}>{inputError}</p>}
      <p className="text-xs mb-4" style={{ color: "var(--text-2)" }}>
        For a stock or fund this combines company news, filings with the SEC, and a public Yahoo Finance feed.
      </p>

      {state.status === "idle" && <EmptyOrError tone="empty" message="Type a ticker above to see its latest headlines." />}
      {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading news for {asked?.ticker}{"…"}</p>}
      {state.status === "error" && <EmptyOrError tone="error" message={state.message} />}
      {state.status === "done" && (
        <>
          {state.data.error ? (
            <EmptyOrError tone="empty" message={state.data.error} />
          ) : (
            <div className="jv-card">
              <div className="jv-br-b" />
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-0)" }}>
                News for {asked?.ticker} ({state.data.items.length})
              </h3>
              <NewsList items={state.data.items} />
            </div>
          )}

          {asked && (asked.assetClass === "equity" || asked.assetClass === "forex" || asked.assetClass === "future" || asked.assetClass === "commodity") && (
            <div className="jv-card mt-4">
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>Background articles (optional)</h3>
              <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                A free index called GDELT lists articles about the topic around this symbol, such as its sector. It matches keywords, so
                some results may not be about {asked.ticker}. It can take 15 seconds or more, and it often says to wait.
              </p>
              {background.status === "idle" && <button className="jv-btn-outline" onClick={() => void loadBackground()}>Load background articles</button>}
              {background.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Asking GDELT{"…"} this is slow.</p>}
              {background.status === "error" && <EmptyOrError tone="error" message={background.message} />}
              {background.status === "done" && (bgItems.length > 0 ? <NewsList items={bgItems} /> : <EmptyOrError tone="empty" message={background.data.sources.find((s) => s.name === "GDELT background")?.note ?? "GDELT had nothing for this topic right now."} />)}
            </div>
          )}

          <SourceList sources={background.status === "done" ? background.data.sources : state.data.sources} />
          <SectionFooter section={state.data} />
        </>
      )}
      {state.status !== "done" && <div className="mt-4"><NotAdviceNote /></div>}
    </div>
  );
}

/** What's moving on the user's own list: which symbols have the most headlines in the last 24 hours. It counts headlines only. */
function BusiestStrip({ groups }: { groups: WatchlistNewsSection["groups"] }) {
  const busiest = groups.filter((g) => g.last24h >= 3).sort((a, b) => b.last24h - a.last24h).slice(0, 3);
  return (
    <div className="jv-card mb-3">
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>
        What&apos;s moving on your list
      </h3>
      {busiest.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-1)" }}>
          No symbol on your list has 3 or more headlines from the last 24 hours. That is normal on a quiet day.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {busiest.map((g) => (
            <li key={`${g.symbol}|${g.assetClass}`} className="text-sm" style={{ color: "var(--text-0)" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{g.symbol}</span>
              <span className="text-xs ml-1" style={{ color: "var(--text-2)" }}>{g.last24h} headlines in 24 h</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
        This counts headlines. A busy news day does not mean the price moved, and it does not say which way.
      </p>
    </div>
  );
}

function WatchlistView() {
  const { entries, hydrated } = useWatchlist();
  const [state, setState] = useState<Load<WatchlistNewsSection>>({ status: "idle" });
  const key = entries.map((e) => `${e.symbol}|${e.assetClass}`).join(",");
  const lastKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getJson<WatchlistNewsSection>("/api/news-hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: entries.map((e) => ({ symbol: e.symbol, assetClass: e.assetClass })) }),
      });
      setState({ status: "done", data });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "News could not be loaded." });
    }
    // The list is read through `key` so the callback only changes when the list does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated || entries.length === 0 || lastKey.current === key) return;
    lastKey.current = key;
    void load();
  }, [hydrated, entries.length, key, load]);

  if (!hydrated) return <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading your watchlist{"…"}</p>;
  if (entries.length === 0) {
    return (
      <div>
        <EmptyOrError tone="empty" message="Your watchlist is empty. Add a symbol on any watchlist screen, then come back to see its headlines here." />
        <div className="mt-4"><NotAdviceNote /></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Headlines for each symbol on your active watchlist, from a public Yahoo Finance feed. Up to 12 symbols are shown.
        </p>
        <button className="jv-btn-outline shrink-0" onClick={() => void load()} disabled={state.status === "loading"}>
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>
      {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading headlines{"…"}</p>}
      {state.status === "error" && <EmptyOrError tone="error" message={state.message} />}
      {state.status === "done" && (
        <>
          {state.data.error ? (
            <EmptyOrError tone="error" message={state.data.error} />
          ) : (
            <>
              <BusiestStrip groups={state.data.groups} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {state.data.groups.map((g) => (
                <div key={`${g.symbol}|${g.assetClass}`} className="jv-card">
                  <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>{g.symbol}</div>
                  {g.items.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--text-2)" }}>{g.note ?? "No recent headlines for this symbol."}</p>
                  ) : (
                    <NewsList items={g.items} />
                  )}
                </div>
              ))}
              </div>
            </>
          )}
          {state.data.skipped.length > 0 && (
            <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
              Left out: {state.data.skipped.map((s) => `${s.symbol} (${s.reason})`).join("; ")}
            </p>
          )}
          <SourceList sources={state.data.sources} />
          <SectionFooter section={state.data} />
        </>
      )}
      {state.status !== "done" && <div className="mt-4"><NotAdviceNote /></div>}
    </div>
  );
}

export function NewsHubTab() {
  const [view, setView] = useState<View>("market");
  return (
    <div className="jarvis">
      <p className="jv-lede">
        News in one place. Each line shows who published it, when, and a link to the original page. We show only the headline and the
        link, never the article. Headlines are information, not advice. Some outlets write opinion or promotional headlines, and we show each one as written.
      </p>
      <div role="tablist" aria-label="News views" className="flex flex-wrap gap-2 mb-4">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            id={`news-hub-tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls={`news-hub-panel-${v.id}`}
            className={view === v.id ? "jv-btn" : "jv-btn-outline"}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`news-hub-panel-${view}`} aria-labelledby={`news-hub-tab-${view}`}>
        {view === "market" && <MarketView />}
        {view === "ticker" && <TickerView />}
        {view === "watchlist" && <WatchlistView />}
      </div>
    </div>
  );
}
