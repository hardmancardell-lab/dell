"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import type { NewsImpactResult } from "@/lib/news-impact/analyze";
import type { GroupTest } from "@/lib/news-impact/types";
import { ResearchNotice } from "./ResearchNotice";

/**
 * News Impact panel: how much do dated company events and scheduled macro days move this asset, and how much of its
 * movement is market-wide? Plain words first, charts second, numbers (with n and intervals) under the charts.
 *
 * Mount it anywhere that knows a ticker and an asset class, for example under the price chart or in the News hub:
 *
 *   import { NewsImpactPanel } from "@/components/NewsImpactPanel";
 *   <NewsImpactPanel symbol={symbol} assetClass={assetClass} />
 *
 * Under the chart, pass it through TickerNewsBelowChart's impactSlot prop (src/components/navigation/ChartNews.tsx):
 *   <TickerNewsBelowChart ... impactSlot={<NewsImpactPanel symbol={symbol} assetClass={assetClass} />} />
 * In the News hub's "One ticker" view, mount it under the headlines with autoLoad.
 *
 * It fetches /api/news-impact itself (signed-in session, rate limited, cached on the server). It needs no provider and no
 * context. By default it waits for a click, because one run makes several data calls (prices, filings, release dates).
 * It never says news causes a price move: it says what moves with what.
 */

export interface NewsImpactPanelProps {
  /** The symbol, for example AAPL, BTC-USD or EUR/USD. `ticker` is accepted too. */
  symbol?: string;
  ticker?: string;
  assetClass: AssetClass;
  /** Run as soon as it shows. Default false: it shows a "Run the study" button first. */
  autoLoad?: boolean;
  className?: string;
}

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; data: NewsImpactResult };

// ------------------------------------------------------------------------------------------------ small helpers

const fx = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v.toFixed(d)}x`);
const pct0 = (v: number): string => `${Math.round(v * 100)}%`;
function fmtDay(iso: string | null): string {
  if (!iso) return "n/a";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "n/a";
}

/** A result is called clear when the corrected test passes and the whole interval sits above 1. */
function isClear(t: GroupTest): boolean {
  return t.enough && t.pAdj !== null && t.pAdj < 0.05 && t.ratioLo !== null && t.ratioLo > 1;
}

// ------------------------------------------------------------------------------------------------ chart 1: bars with intervals

export interface BarRow {
  key: string;
  label: string;
  test: GroupTest;
  /** Extra text, for example the raw percent move. */
  note?: string;
  /** Fewest events this row needs before it shows a bar (the headline row needs more than a type row). */
  min?: number;
}

/**
 * Horizontal bars that start at zero. Bar length is how big an event day's surprise move was compared with an ordinary
 * day (1.0x = the same). The whisker is the 95% interval. A dashed line marks 1.0x. Rows without enough events show words
 * instead of a bar, never a number framed as a finding.
 */
export function ImpactBars({ rows, minEvents, ariaLabel, what = "surprise move" }: { rows: BarRow[]; minEvents: number; ariaLabel: string; what?: string }) {
  const shown = rows.filter((r) => r.test.enough);
  const hi = Math.max(2, ...shown.map((r) => Math.max(r.test.ratio ?? 0, r.test.ratioHi ?? 0)));
  const max = Math.ceil(hi * 1.08 * 2) / 2;
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-col gap-2">
      {rows.map((r) => {
        const t = r.test;
        const clear = isClear(t);
        return (
          <div key={r.key} className="grid items-center gap-x-3 gap-y-1" style={{ gridTemplateColumns: "minmax(110px, 36%) 1fr" }}>
            <div className="text-xs" style={{ color: "var(--text-1)" }}>
              {r.label}
              <span style={{ color: "var(--text-2)" }}> (n = {t.n})</span>
            </div>
            {t.enough && t.ratio !== null ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1" style={{ height: 16 }}>
                  <div className="absolute inset-0" style={{ background: "var(--ink-800)", borderRadius: 2 }} />
                  <div className="absolute" style={{ left: 0, top: 3, height: 10, width: at(t.ratio), background: clear ? "var(--signal)" : "var(--line-bright)", borderRadius: 2, opacity: t.thin ? 0.55 : 1 }} />
                  {t.ratioLo !== null && t.ratioHi !== null && (
                    <>
                      <div className="absolute" style={{ left: at(t.ratioLo), width: `calc(${at(t.ratioHi)} - ${at(t.ratioLo)})`, top: 7, height: 2, background: "var(--text-0)" }} />
                      <div className="absolute" style={{ left: at(t.ratioLo), top: 3, width: 1, height: 10, background: "var(--text-0)" }} />
                      <div className="absolute" style={{ left: at(t.ratioHi), top: 3, width: 1, height: 10, background: "var(--text-0)" }} />
                    </>
                  )}
                  <div className="absolute" style={{ left: at(1), top: 0, width: 0, height: 16, borderLeft: "1px dashed var(--verdict)" }} />
                </div>
                <div className="text-xs font-mono shrink-0" style={{ color: "var(--text-0)", minWidth: 128 }}>
                  {fx(t.ratio)} ({fx(t.ratioLo)}{"–"}{fx(t.ratioHi)})
                </div>
              </div>
            ) : (
              <div className="text-xs" style={{ color: "var(--text-2)" }}>
                Not enough events to say (need {r.min ?? minEvents}).
              </div>
            )}
            {(r.note || (t.enough && t.thin)) && (
              <div className="text-xs" style={{ gridColumn: "2", color: "var(--text-2)" }}>
                {t.enough && t.thin ? "Few events, so read with care. " : ""}
                {r.note}
              </div>
            )}
          </div>
        );
      })}
      <div className="grid gap-x-3" style={{ gridTemplateColumns: "minmax(110px, 36%) 1fr" }} aria-hidden="true">
        <span />
        <div className="relative text-xs font-mono flex items-center gap-2" style={{ color: "var(--text-2)", height: 16 }}>
          <div className="relative flex-1" style={{ height: 16 }}>
            <span className="absolute" style={{ left: 0 }}>0</span>
            <span className="absolute" style={{ left: at(1), transform: "translateX(-50%)", color: "var(--verdict)" }}>1x</span>
            <span className="absolute" style={{ right: 0 }}>{max}x</span>
          </div>
          <div style={{ minWidth: 128 }} />
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--text-2)" }}>
        Bars show the size of the {what} on those days compared with an ordinary day (the dashed line, 1x). The thin line is the 95% range.
        Bright bars passed the corrected test.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ chart 2: split bar

export function SplitBar({ segments, ariaLabel }: { segments: { key: string; label: string; share: number; color: string }[]; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex w-full" style={{ height: 26, background: "var(--ink-800)", borderRadius: 2, overflow: "hidden" }}>
        {segments.map((s) => (
          <div key={s.key} className="flex items-center justify-center text-xs font-mono" style={{ width: `${Math.max(0, s.share * 100)}%`, background: s.color, color: "var(--ink-950)", fontWeight: 600 }}>
            {s.share >= 0.1 ? pct0(s.share) : ""}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs font-mono mt-1" style={{ color: "var(--text-2)" }} aria-hidden="true">
        <span>0%</span>
        <span>100% of the asset&apos;s daily ups and downs</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: "var(--text-1)" }}>
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, background: s.color, borderRadius: 2 }} />
            {s.label}: <span className="font-mono" style={{ color: "var(--text-0)" }}>{pct0(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the panel

const BAD = "var(--danger)";

export function NewsImpactPanel({ symbol, ticker: tickerProp, assetClass, autoLoad = false, className }: NewsImpactPanelProps) {
  const ticker = (symbol ?? tickerProp ?? "").trim();
  const [state, setState] = useState<Load>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/news-impact?ticker=${encodeURIComponent(ticker)}&assetClass=${encodeURIComponent(assetClass)}`, { signal: ctl.signal });
      if (res.status === 401) {
        setState({ status: "error", message: "Your session has ended. Sign in again to run the study." });
        return;
      }
      if (!res.ok) {
        let message = "The News Impact study could not run right now. Try again in a few minutes.";
        try {
          const j = await res.json();
          if (typeof j?.error === "string") message = j.error;
        } catch {
          /* keep the generic sentence */
        }
        setState({ status: "error", message });
        return;
      }
      setState({ status: "done", data: (await res.json()) as NewsImpactResult });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setState({ status: "error", message: "The network did not answer. Check your connection and try again." });
    }
  }, [ticker, assetClass]);

  useEffect(() => {
    if (autoLoad && ticker) void run();
    else setState({ status: "idle" });
    return () => abortRef.current?.abort();
  }, [autoLoad, ticker, run]);

  const sym = ticker.toUpperCase();
  return (
    <section className={`jv-card ${className ?? ""}`.trim()} aria-label={`News impact for ${sym}`} data-testid="news-impact-panel">
      <div className="jv-br-b" />
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <div className="jv-eyebrow">News impact</div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>
            How much does news move {sym}?
          </h3>
        </div>
        {state.status !== "loading" && (
          <button className="jv-btn-outline shrink-0" onClick={() => void run()}>
            {state.status === "idle" ? "Run the study" : "Run again"}
          </button>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        Two questions: do days with company filings or scheduled macro news move it more than other days, and how much of its movement just follows the
        market? This shows what moves with what. It does not show that news causes a move.
      </p>

      {state.status === "idle" && <p className="text-sm" style={{ color: "var(--text-1)" }}>Press the button to run the study. It uses about five years of prices and the company&apos;s SEC filings.</p>}
      {state.status === "loading" && <p className="text-sm" style={{ color: "var(--text-2)" }}>Running the study for {sym}{"…"} this can take up to a minute the first time.</p>}
      {state.status === "error" && (
        <p role="alert" className="text-sm" style={{ color: BAD }}>
          {state.message}
        </p>
      )}
      {state.status === "done" && <NewsImpactView data={state.data} />}

      <div className="mt-4">
        <ResearchNotice
          source="daily prices (Alpaca, Coinbase or OANDA, by asset type), SEC EDGAR filings, FRED or BLS release dates"
          asOf={state.status === "done" ? state.data.asOf : null}
          sampleSize={state.status === "done" ? state.data.business.study?.pooled.day0.n ?? state.data.sample.returns : null}
          testsRun={state.status === "done" ? (state.data.business.study?.testsInFamily ?? 0) + (state.data.macro.study?.testsInFamily ?? 0) : null}
          hypothetical={false}
        >
          This is a statistical study of past prices. Moves that went with news in the past may not repeat. Correlation is not cause.
        </ResearchNotice>
      </div>
    </section>
  );
}

/** The results part of the panel, for a caller that already has the study result (tests, previews). */
export function NewsImpactView({ data }: { data: NewsImpactResult }) {
  const study = data.business.study;
  const decomp = data.systematic.decomposition;
  const macro = data.macro.study;

  const businessRows: BarRow[] = study
    ? [study.pooled, ...study.groups].map((g) => ({
        key: g.id,
        label: g.label,
        test: g.day0,
        min: g.id === "all" ? study.minHeadlineEvents : study.minTypeEvents,
        note:
          g.day0.enough && g.absArPctEvent !== null && g.absArPctBase !== null
            ? `Average surprise move ${g.absArPctEvent.toFixed(2)}% on these days, ${g.absArPctBase.toFixed(2)}% on other days.`
            : undefined,
      }))
    : [];
  const macroRows: BarRow[] = macro
    ? [macro.pooled, ...macro.groups].map((g) => ({
        key: g.id,
        label: g.label,
        test: g.test,
        note:
          g.test.enough && g.absRetPctEvent !== null && g.absRetPctBase !== null
            ? `Average move ${g.absRetPctEvent.toFixed(2)}% on these days, ${g.absRetPctBase.toFixed(2)}% on other days.`
            : undefined,
      }))
    : [];

  const segColors = ["var(--signal)", "var(--signal-dim)"];
  const segments = decomp
    ? [
        ...decomp.slices.map((s, i) => ({ key: s.symbol, label: `Moves with ${s.label}`, share: s.r2Added ?? 0, color: segColors[i % segColors.length] })),
        { key: "own", label: `Its own (${data.plan.ownLabel})`, share: decomp.ownShare, color: "var(--verdict)" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      {/* A. company news days */}
      <div>
        <h4 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>1. Company news days (SEC filings)</h4>
        <p className="text-sm mb-2" style={{ color: "var(--text-1)" }}>{data.business.verdict.text}</p>
        {study && (
          <ImpactBars
            rows={businessRows}
            minEvents={study.minTypeEvents}
            ariaLabel={`Size of ${data.symbol}'s surprise move on company filing days compared with ordinary days, by type of filing, with 95 percent ranges and the number of days.`}
          />
        )}
        {study && (
          <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
            The first row needs {study.minHeadlineEvents} filing days to count; each type needs {study.minTypeEvents}. A filing is a dated event, not a count of headlines.{" "}
            {study.testsInFamily} tests were run in all. The first row is corrected on its own; the type rows are corrected together. Bright bars passed.
          </p>
        )}
      </div>

      {/* B1. market-wide split */}
      <div>
        <h4 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>2. How much just follows the market</h4>
        <p className="text-sm mb-2" style={{ color: "var(--text-1)" }}>{data.systematic.text}</p>
        {data.systematic.stability && (
          <p className="text-xs mb-2" style={{ color: decomp?.stable === false ? "var(--verdict)" : "var(--text-2)" }}>{data.systematic.stability}</p>
        )}
        {decomp && (
          <>
            <SplitBar
              segments={segments}
              ariaLabel={`Share of ${data.symbol}'s daily variance: ${segments.map((s) => `${s.label} ${pct0(s.share)}`).join(", ")}.`}
            />
            <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
              Based on {decomp.n} daily returns, {fmtDay(decomp.from)} to {fmtDay(decomp.to)}. Each slice is the extra share a benchmark explains after the ones
              before it.
            </p>
          </>
        )}
      </div>

      {/* B2. macro days */}
      <div>
        <h4 className="text-sm font-semibold mb-1" style={{ color: "var(--text-0)" }}>3. Fed, inflation and jobs days</h4>
        <p className="text-sm mb-2" style={{ color: "var(--text-1)" }}>{data.macro.text}</p>
        {macro && (
          <ImpactBars
            rows={macroRows}
            minEvents={10}
            what="move"
            ariaLabel={`Size of ${data.symbol}'s move on scheduled macro days compared with ordinary days, by kind of report, with 95 percent ranges and the number of days.`}
          />
        )}
      </div>

      <details className="text-xs" style={{ color: "var(--text-2)" }}>
        <summary className="cursor-pointer" style={{ color: "var(--text-1)" }}>How this was measured, and its limits</summary>
        <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-4">
          <li>Prices through {fmtDay(data.dataThrough)}; study run {fmtDay(data.asOf)}. {data.sample.returns} daily returns used.</li>
          <li>Benchmarks used: {data.plan.factors.filter((f) => f.loaded).map((f) => `${f.symbol} (${f.label})`).join(", ") || "none"}.</li>
          {data.plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>A surprise move is the part of a day&apos;s move the market did not explain, measured against how wild that asset normally is. It is a size, not a direction.</li>
          <li>Filings are a stand-in for company news. Many headlines have no filing, and ordinary days here means days with no dated filing, not days with no news.</li>
          <li>A result of &quot;no clear difference&quot; is not proof of no effect. The range shows the biggest effect the data cannot rule out.</li>
          <li>Moving with the market, the sector or an event day does not show cause. Another thing may drive both.</li>
        </ul>
      </details>
    </div>
  );
}

export default NewsImpactPanel;
