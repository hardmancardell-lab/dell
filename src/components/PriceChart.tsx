"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAME_PRESETS } from "@/lib/agents/trading-agent/skills/timeframe-presets";
import { SESSIONS, toUtcParts } from "@/lib/agents/trading-agent/skills/time-windows";
import type { ChartBarsResult } from "@/lib/agents/trading-agent/skills/chart-bars";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import type { BarAdjustment, CorporateEvent } from "@/lib/data/market-data-types";
import { INDICATORS } from "@/lib/chart/indicators";
import { formatBarLabel, formatTick, zoneForProvider, type ChartZone } from "@/lib/chart/timeformat";
import { effectiveScaleMode, loadScaleChoice, saveScaleChoice, SCALE_DESCRIPTIONS, SCALE_LABELS, SCALE_MODES, type ScaleMode } from "@/lib/chart/scale";
import { extendedShadeRanges, filterExtendedHours, hasExtendedBars } from "@/lib/chart/sessions";
import { CHART_CHROME } from "@/lib/chart/colors";
import { SessionShade } from "./chart/SessionShade";
import { ToggleGroup } from "./chart/ToggleGroup";
import { ChartHeader } from "./chart/ChartHeader";
import { IndicatorManager } from "./chart/IndicatorManager";
import { DrawingController, type DrawingUiState } from "./chart/DrawingController";
import { DrawingToolbar } from "./chart/DrawingToolbar";
import { ShortcutsHelp } from "./chart/ShortcutsHelp";
import { INDICATOR_PRESETS, clearLayout, loadLayout, matchingPreset, presetById, saveLayout, type ChartLayout } from "@/lib/chart/layout";
import { SCALE_CYCLE, isTypingTarget, shortcutFor, stepTimeframe } from "@/lib/chart/shortcuts";
import { drawingsStorageKey, loadDrawings, saveDrawings } from "@/lib/chart/drawings";
import { eventsToMarkers } from "@/lib/chart/events";
import { formatDay } from "@/lib/chart/timeformat";
import { ActiveLegend } from "./chart/ActiveLegend";
import dynamic from "next/dynamic";
import { JARVIS as TOKENS, SMA_COLORS, VOLUME_BAR } from "@/lib/design/tokens";
// The floating trade panel is only opened on demand; loading these lazily keeps recharts (via OptionsChainTradeTab) and the
// order form out of every chart consumer's first load.
const PaperOrderForm = dynamic(() => import("./PaperOrderForm").then((m) => m.PaperOrderForm));
const OptionsChainTradeTab = dynamic(() => import("./OptionsChainTradeTab").then((m) => m.OptionsChainTradeTab));
import type { AssetClass, PaperAccountSummary } from "@/lib/agents/trading-agent/types";
import { sma, type VolumeProfileResult } from "@/lib/agents/trading-agent/skills/technical-indicators";

function toSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

// Indicator catalogue (ids, labels, estimate tags) lives in src/lib/chart/indicators.ts.
const OVERLAY_INDICATORS = INDICATORS.filter((d) => d.group === "overlay");
const OSCILLATOR_INDICATORS = INDICATORS.filter((d) => d.group === "oscillator");


// Chart theme from the shared jarvis tokens (canvas cannot resolve var(--...)); drift is checked by
// scripts/quality/check-design-tokens.cjs.
const JARVIS = {
  inkBg: TOKENS.ink900,
  line: TOKENS.line,
  text1: TOKENS.text1,
  signal: TOKENS.signal,
  danger: TOKENS.danger,
  verdict: TOKENS.verdict,
};

/** Writes the OHLCV legend for candle `index` into `el` (hidden when there is no candle). Plain DOM, no React state. */
function writeLegend(
  el: HTMLDivElement | null,
  candles: ChartBarsResult["candles"],
  index: number,
  timeframeId: string,
  fmt: (v: number) => string,
  zone: ChartZone,
  extra = ""
) {
  if (!el) return;
  if (index < 0 || index >= candles.length) {
    el.style.display = "none";
    return;
  }
  const c = candles[index];
  const prior = index > 0 ? candles[index - 1] : null;
  const changePct = prior && prior.close > 0 ? ((c.close - prior.close) / prior.close) * 100 : null;
  const preset = TIMEFRAME_PRESETS.find((p) => p.id === timeframeId);
  const isIntraday = !(preset?.alpacaTimeframe === "1Day" || preset?.alpacaTimeframe === "1Week");
  const dateKey = formatBarLabel(Math.floor(c.datetime / 1000), zone, isIntraday);
  const span = (text: string, color?: string) => {
    const e = document.createElement("span");
    e.textContent = text;
    if (color) e.style.color = color;
    return e;
  };
  const changeAbs = prior ? c.close - prior.close : null;
  const rangePct = c.low > 0 ? ((c.high - c.low) / c.low) * 100 : null;
  const changeColor = changePct === null ? "var(--text-2)" : changePct >= 0 ? "var(--signal)" : "var(--danger)";
  el.replaceChildren(
    span(dateKey, "var(--text-0)"),
    span(`  O ${fmt(c.open)}  H ${fmt(c.high)}  L ${fmt(c.low)}  C ${fmt(c.close)}  `),
    span(changePct !== null ? `${changeAbs !== null ? `${changeAbs >= 0 ? "+" : ""}${fmt(changeAbs)} ` : ""}(${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)` : "N/A", changeColor),
    span(`  Range ${rangePct !== null ? `${rangePct.toFixed(2)}%` : "N/A"}  Vol ${c.volume.toLocaleString()}`),
    ...(extra ? [lineBreak(), span(extra)] : [])
  );
  el.style.display = "block";
}

function lineBreak(): HTMLElement {
  return document.createElement("br");
}

/** Formats an indicator value for the crosshair line: two decimals, or none for large cumulative values (OBV). */
function fmtReadout(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  return Math.abs(v) >= 100000 ? v.toExponential(2) : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

/** ET calendar date "YYYY-MM-DD" of an instant, for placing events on the first bar of their date. */
const etDayKey = (ms: number) => formatDay(Math.floor(ms / 1000), "America/New_York");

export function PriceChart({
  symbol,
  focusDate,
  assetClass = "equity",
  readOnly = false,
  onManager,
  onCreateAlert,
}: {
  symbol: string;
  focusDate?: string;
  assetClass?: AssetClass;
  /** Hides the click-to-trade button/panel — for read-only contexts like the client-facing dashboard. */
  readOnly?: boolean;
  /** Test hook: receives the IndicatorManager when the chart is created (null on teardown is not reported). */
  onManager?: (m: IndicatorManager) => void;
  /**
   * Chart-to-alert hook. When the host gives this, a selected horizontal line shows an "Alert at this level" button that
   * calls it with the symbol, the price and whether the level is above or below the last price. The Alerts tab has no
   * prefill entry point yet (see fix-batch-D.md), so no host passes it today.
   */
  onCreateAlert?: (a: { symbol: string; price: number; direction: "above" | "below" }) => void;
}) {
  const onManagerRef = useRef(onManager);
  onManagerRef.current = onManager;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const managerRef = useRef<IndicatorManager | null>(null);
  const drawingRef = useRef<DrawingController | null>(null);
  const drawKeyRef = useRef("");
  const compareSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const refreshLegendRef = useRef<() => void>(() => {});
  const timesRef = useRef<number[]>([]);
  const positionLineRef = useRef<IPriceLine | null>(null);
  const orderLinesRef = useRef<IPriceLine[]>([]);
  const sessionMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const shadeRef = useRef<SessionShade | null>(null);
  const assetClassRef = useRef<AssetClass>(assetClass);
  assetClassRef.current = assetClass;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const dataRef = useRef<ChartBarsResult | null>(null);
  const timeframeRef = useRef("1yr");
  // The OHLCV legend is written straight into a small element (legendRef) instead of React state: the crosshair
  // fires on every mouse move, and a setState there re-rendered this whole 900-line component (toolbar, indicator
  // checkboxes, trade panel) up to 60 times a second (audit F4).
  const legendRef = useRef<HTMLDivElement>(null);
  const fmtPxRef = useRef<(v: number) => string>((v) => v.toFixed(2));
  const hoverSecondsRef = useRef<number | null>(null);
  const indexByTimeRef = useRef<Map<number, number>>(new Map());

  // 1mo (1-day candles, ~1 month lookback) gives useful before/after context
  // around a single occurrence date without pulling a whole year of noise.
  const [timeframe, setTimeframe] = useState(focusDate ? "1mo" : "1yr");
  timeframeRef.current = timeframe;
  // Split-adjusted by default so a split is not drawn as a crash. Only equities and ETFs (Alpaca) have a choice.
  const [adjustment, setAdjustment] = useState<BarAdjustment>("split");
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [enabledOverlays, setEnabledOverlays] = useState<Set<string>>(new Set());
  const [enabledOscillators, setEnabledOscillators] = useState<Set<string>>(new Set());
  const [volumeProfileSummary, setVolumeProfileSummary] = useState<VolumeProfileResult | null>(null);
  const [data, setData] = useState<ChartBarsResult | null>(null);
  dataRef.current = data;
  // Display zone: US equity bars in Eastern time (the exchange clock), everything else UTC. Printed in the header.
  const zone: ChartZone = zoneForProvider(data?.meta?.provider);
  const zoneRef = useRef<ChartZone>(zone);
  zoneRef.current = zone;
  const intraday = (data?.meta?.barMs ?? 86_400_000) < 86_400_000;
  const intradayRef = useRef(intraday);
  intradayRef.current = intraday;

  // Extended hours: only intraday US equity bars have a pre-market and after-hours session. The toggle filters those bars
  // out of everything (candles, volume, indicators); the shading marks them while they are shown.
  const [drawUi, setDrawUi] = useState<DrawingUiState>({ tool: "select", selectedId: null, count: 0, color: "", hint: "" });
  const [includeExtended, setIncludeExtended] = useState(true);
  // Compare overlay: a second symbol drawn as a percent-change line on the SAME percent axis as the price (never a second axis).
  const [compareInput, setCompareInput] = useState("");
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [compareRaw, setCompareRaw] = useState<ChartBarsResult | null>(null);
  const [compareNote, setCompareNote] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Saved layout: loaded once at mount (before the first fetch, so the saved timeframe is the one fetched).
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  // Splits and dividends from the provider (equities only). `eventsNote` says why there are none when the source is unavailable.
  const [events, setEvents] = useState<CorporateEvent[]>([]);
  const [eventsNote, setEventsNote] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(true);
  const extendedApplicable = Boolean(data?.meta && data.meta.provider === "Alpaca" && intraday);
  const extendedPresent = useMemo(
    () => (extendedApplicable && data ? hasExtendedBars(data.candles.map((c) => c.datetime)) : false),
    [extendedApplicable, data]
  );
  // The bars everything below draws. Same array identity until the data or the toggle changes.
  const candles = useMemo(
    () => (data ? (extendedApplicable ? filterExtendedHours(data.candles, includeExtended) : data.candles) : []),
    [data, extendedApplicable, includeExtended]
  );
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  timesRef.current = useMemo(() => candles.map((c) => Math.floor(c.datetime / 1000)), [candles]);

  // Price-scale mode: the user's choice (remembered for the browser session) or the default for the range (log from 2 years).
  const [scaleChoice, setScaleChoice] = useState<ScaleMode | null>(null);
  useEffect(() => {
    const saved = loadLayout();
    setScaleChoice(loadScaleChoice());
    if (saved) {
      if (!focusDate) setTimeframe(saved.timeframe);
      setAdjustment(saved.adjustment);
      setEnabledOverlays(new Set(saved.overlays));
      setEnabledOscillators(new Set(saved.oscillators));
      setShowSma20(saved.showSma20);
      setShowSma50(saved.showSma50);
      setIncludeExtended(saved.includeExtended);
      if (saved.scale) setScaleChoice(saved.scale);
      setLayoutNote(saved.savedAt ? `Saved layout restored (${saved.savedAt.slice(0, 10)}).` : "Saved layout restored.");
    }
    setLayoutReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lookbackMs = TIMEFRAME_PRESETS.find((p) => p.id === timeframe)?.lookbackMs ?? 0;
  const minLow = useMemo(() => {
    let m: number | null = null;
    for (const c of candles) if (m === null || c.low < m) m = c.low;
    return m;
  }, [candles]);
  const compareActive = compareSymbol !== null && compareRaw !== null && compareRaw.candles.length > 0;
  // With a comparison on, the one axis is percent change from the first visible bar: the two symbols are in different units.
  const scaleMode: ScaleMode = compareActive ? "percent" : effectiveScaleMode(scaleChoice, lookbackMs, minLow);
  const compareCandles = useMemo(
    () => (compareRaw ? (extendedApplicable ? filterExtendedHours(compareRaw.candles, includeExtended) : compareRaw.candles) : []),
    [compareRaw, extendedApplicable, includeExtended]
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(false);
  const [floatingTab, setFloatingTab] = useState<"trade" | "options">("trade");
  const [clickedPrice, setClickedPrice] = useState<number | undefined>(undefined);
  const [positionRefreshKey, setPositionRefreshKey] = useState(0);

  // Sub-dollar coins (DOGE at $0.1234, SHIB far smaller) need more than two decimals in the readout and on the axis.
  const fmtPx = (v: number) => (assetClass === "crypto" && Math.abs(v) < 1 ? String(Number(v.toPrecision(5))) : v.toFixed(2));
  fmtPxRef.current = fmtPx;

  // Rebuild the time -> candle index map when the data changes, and show the latest bar in the legend until the
  // cursor is over a candle.
  useEffect(() => {
    const map = new Map<number, number>();
    candles.forEach((c, i) => map.set(toSeconds(c.datetime), i));
    indexByTimeRef.current = map;
    hoverSecondsRef.current = null;
    refreshLegendRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, assetClass, zone]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const last = candles[candles.length - 1];
    if (!series || assetClass !== "crypto" || !last) return;
    const precision = last.close >= 1 ? 2 : last.close >= 0.01 ? 4 : 8;
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
  }, [candles, assetClass]);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  function toggleOverlay(id: string) {
    setEnabledOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOscillator(id: string) {
    setEnabledOscillators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function currentLayout(): ChartLayout {
    return {
      version: 1,
      overlays: [...enabledOverlays],
      oscillators: [...enabledOscillators],
      scale: scaleChoice,
      timeframe,
      showSma20,
      showSma50,
      adjustment,
      includeExtended,
      savedAt: new Date().toISOString(),
    };
  }

  function submitCompare() {
    const sym = compareInput.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9./-]{0,11}$/.test(sym)) {
      setCompareNote("Enter a ticker such as SPY, QQQ or BTC-USD.");
      return;
    }
    if (sym === symbol.trim().toUpperCase()) {
      setCompareNote("That is the symbol already on the chart.");
      return;
    }
    setCompareNote(null);
    setCompareSymbol(sym);
  }

  /** Keyboard shortcuts: act only while focus is inside this chart section and not in a text box. */
  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target as HTMLElement)) return;
    const dc = drawingRef.current;
    const id = shortcutFor(e.key);
    if (!id) return;
    switch (id) {
      case "tool-select":
      case "tool-hline":
      case "tool-trend":
      case "tool-rect":
        dc?.setTool(id.slice(5) as "select" | "hline" | "trend" | "rect");
        break;
      case "cancel":
        if (shortcutsOpen) setShortcutsOpen(false);
        else dc?.cancel();
        break;
      case "delete":
        if (!drawUi.selectedId) return;
        dc?.deleteSelected();
        break;
      case "select-prev":
      case "select-next":
        dc?.selectNext(id === "select-next" ? 1 : -1);
        break;
      case "nudge":
        if (!drawUi.selectedId) return;
        dc?.nudge(e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0);
        break;
      case "scale-cycle": {
        if (compareActive) return;
        const order = SCALE_CYCLE.filter((m) => m !== "log" || (minLow !== null && minLow > 0));
        const next = order[(order.indexOf(scaleMode) + 1) % order.length];
        setScaleChoice(next);
        saveScaleChoice(next);
        break;
      }
      case "extended":
        if (extendedApplicable && extendedPresent) setIncludeExtended((v) => !v);
        break;
      case "tf-prev":
      case "tf-next":
        setTimeframe((cur) =>
          stepTimeframe(
            TIMEFRAME_PRESETS.filter((p) => p.alpacaTimeframe).map((p) => p.id),
            cur,
            id === "tf-prev" ? -1 : 1
          )
        );
        break;
      case "help":
        setShortcutsOpen((v) => !v);
        break;
    }
    e.preventDefault();
  }

  // Chart lifecycle: create once per mount, dispose on unmount. Single fixed
  // dark theme (jarvis is dark-only by design, no light/OS-preference fork).
  useEffect(() => {
    if (!containerRef.current) return;

    const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: JARVIS.text1,
      },
      grid: {
        vertLines: { color: JARVIS.line },
        horzLines: { color: JARVIS.line },
      },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        // lightweight-charts treats timestamps as UTC; these read the display zone (ET for equities) at draw time.
        tickMarkFormatter: (time: Time, tickType: number) => formatTick(time as number, tickType, zoneRef.current),
      },
      localization: {
        timeFormatter: (time: Time) => formatBarLabel(time as number, zoneRef.current, intradayRef.current),
      },
      // A vertical swipe that starts on the chart must scroll the page, not pan the chart (audit F6), and on touch
      // devices the wheel never zooms. Pinch and horizontal drag still work. On mouse devices the wheel still zooms.
      handleScroll: { vertTouchDrag: false, mouseWheel: !coarse },
      handleScale: { mouseWheel: !coarse, pinch: true, axisPressedMouseMove: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: JARVIS.signal,
      downColor: JARVIS.danger,
      borderVisible: false,
      wickUpColor: JARVIS.signal,
      wickDownColor: JARVIS.danger,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const sma20Series = chart.addSeries(LineSeries, { color: SMA_COLORS.sma20, lineWidth: 1 });
    const sma50Series = chart.addSeries(LineSeries, { color: SMA_COLORS.sma50, lineWidth: 1 });

    managerRef.current = new IndicatorManager(chart, candleSeries, { baseHeight: 420, paneHeight: 150, onProfile: setVolumeProfileSummary });
    onManagerRef.current?.(managerRef.current);
    drawingRef.current = new DrawingController({
      chart,
      series: candleSeries,
      container: containerRef.current,
      getTimes: () => timesRef.current,
      fmtPrice: (v) => fmtPxRef.current(v),
      onPersist: (list) => void saveDrawings(drawKeyRef.current, list),
      onState: setDrawUi,
    });
    drawingRef.current.setDrawings(loadDrawings(drawKeyRef.current));
    const shade = new SessionShade(CHART_CHROME.extendedShade);
    candleSeries.attachPrimitive(shade);
    shadeRef.current = shade;

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    sma20SeriesRef.current = sma20Series;
    sma50SeriesRef.current = sma50Series;

    // Click-to-trade: options aren't chartable here (a click on the
    // underlying can't identify a specific contract — use the Options
    // "Trade Options" chain tab instead), so this only arms for the asset
    // classes this chart actually charts a tradeable instrument for.
    chart.subscribeClick((param) => {
      if (assetClassRef.current === "option" || !param.time || readOnlyRef.current) return;
      const barData = candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : undefined;
      const price = barData && "close" in barData ? (barData as { close: number }).close : undefined;
      setClickedPrice(price);
      setFloatingTab("trade");
      setFloatingPanelOpen(true);
    });

    // Hover detail: real O/H/L/C/change%/volume for whatever candle the
    // cursor is over, found by matching the crosshair's time back to the
    // real candle list (not just whatever lightweight-charts' own
    // seriesData snapshot exposes, since that doesn't include volume or a
    // prior-close-based change%).
    // Second legend line: the value of every active indicator, the moving averages and the comparison at the cursor bar
    // (or at the newest bar when the cursor is off the data).
    const readoutLine = (valueOf: (s: ISeriesApi<SeriesType>) => number | null): string => {
      const parts: string[] = [];
      const one = (label: string, s: ISeriesApi<SeriesType> | null) => {
        if (s) parts.push(`${label} ${fmtReadout(valueOf(s))}`);
      };
      if (sma20Series.options().visible) one("SMA20", sma20Series);
      if (sma50Series.options().visible) one("SMA50", sma50Series);
      for (const r of managerRef.current?.readouts(valueOf) ?? []) parts.push(`${r.label} ${r.values.map(fmtReadout).join("/")}`);
      if (compareSeriesRef.current) parts.push(`${compareSeriesRef.current.options().title || "Compare"} ${fmtReadout(valueOf(compareSeriesRef.current))} (price)`);
      return parts.join("  |  ");
    };
    const lastValue = (s: ISeriesApi<SeriesType>): number | null => {
      const arr = s.data() as readonly { value?: number }[];
      const v = arr.length ? arr[arr.length - 1].value : undefined;
      return typeof v === "number" ? v : null;
    };
    refreshLegendRef.current = () => {
      const candles = candlesRef.current;
      if (candles.length === 0) return;
      const seconds = hoverSecondsRef.current;
      const index = seconds === null ? -1 : (indexByTimeRef.current.get(seconds) ?? -1);
      const at = (s: ISeriesApi<SeriesType>): number | null => {
        if (index === -1) return lastValue(s);
        const t = candles[index].datetime / 1000;
        const row = (s.data() as readonly { time?: number; value?: number }[]).find((d) => d.time === t);
        return typeof row?.value === "number" ? row.value : null;
      };
      writeLegend(legendRef.current, candles, index === -1 ? candles.length - 1 : index, timeframeRef.current, fmtPxRef.current, zoneRef.current, readoutLine(at));
    };
    chart.subscribeCrosshairMove((param) => {
      const candles = candlesRef.current;
      if (candles.length === 0) return;
      const seconds = param.time ? (param.time as number) : null;
      // Skip work while the cursor stays on the same candle.
      if (seconds === hoverSecondsRef.current) return;
      hoverSecondsRef.current = seconds;
      const index = seconds === null ? -1 : (indexByTimeRef.current.get(seconds) ?? -1);
      const valueOf = (s: ISeriesApi<SeriesType>): number | null => {
        if (index === -1) return lastValue(s);
        const d = param.seriesData.get(s) as { value?: number } | undefined;
        return typeof d?.value === "number" ? d.value : null;
      };
      // Off the data (or cursor left the chart): fall back to the latest bar.
      writeLegend(legendRef.current, candles, index === -1 ? candles.length - 1 : index, timeframeRef.current, fmtPxRef.current, zoneRef.current, readoutLine(valueOf));
    });

    let lastWidth = containerRef.current.clientWidth;
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      chart.applyOptions({ width });
      // A chart created while hidden (zero or tiny width) fitted its bars into almost nothing: fit again once it has room.
      if (lastWidth < 120 && width >= 120) chart.timeScale().fitContent();
      lastWidth = width;
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      managerRef.current = null;
      drawingRef.current?.dispose();
      drawingRef.current = null;
      positionLineRef.current = null;
      orderLinesRef.current = [];
      // Cleared so a StrictMode remount builds fresh plugins on the new chart instead of reusing ones bound to the removed one (audit F16).
      sessionMarkersRef.current = null;
      shadeRef.current = null;
    };
  }, []);

  // Drawings belong to a symbol and timeframe: swap the list when either changes (and once at mount).
  useEffect(() => {
    drawKeyRef.current = drawingsStorageKey(symbol, timeframe);
    drawingRef.current?.setDrawings(loadDrawings(drawKeyRef.current));
  }, [symbol, timeframe]);

  // New bars: re-anchor the drawings on them.
  useEffect(() => {
    drawingRef.current?.redraw();
  }, [candles]);

  // Price-scale mode on the main (right) scale. Volume and the oscillator panes keep their own scales.
  useEffect(() => {
    const mode = scaleMode === "log" ? PriceScaleMode.Logarithmic : scaleMode === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal;
    chartRef.current?.priceScale("right").applyOptions({ mode });
  }, [scaleMode]);

  // Shade the pre-market and after-hours bars while they are shown.
  useEffect(() => {
    const ranges = extendedApplicable && includeExtended ? extendedShadeRanges(candles) : [];
    shadeRef.current?.setRanges(ranges.map((r) => ({ fromSec: toSeconds(r.fromMs), toSec: toSeconds(r.toMs) })));
  }, [candles, extendedApplicable, includeExtended]);

  // Fetch on symbol/timeframe change.
  useEffect(() => {
    if (!symbol || !layoutReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = `/api/chart-bars?ticker=${encodeURIComponent(symbol)}&timeframe=${timeframe}&adjustment=${adjustment}`;
    const url = focusDate ? `${base}&centerDate=${focusDate}` : base;

    fetch(url)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setData(json as ChartBarsResult);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, focusDate, adjustment, layoutReady]);

  // Compare symbol bars: same timeframe and adjustment as the main chart. A failure shows a note and draws nothing.
  useEffect(() => {
    if (!compareSymbol || !layoutReady) {
      setCompareRaw(null);
      return;
    }
    let cancelled = false;
    setCompareNote(null);
    const base = `/api/chart-bars?ticker=${encodeURIComponent(compareSymbol)}&timeframe=${timeframe}&adjustment=${adjustment}`;
    fetch(focusDate ? `${base}&centerDate=${focusDate}` : base)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !Array.isArray(json?.candles) || json.candles.length === 0) {
          setCompareRaw(null);
          setCompareNote(`No data for ${compareSymbol}${json?.error ? `: ${String(json.error).slice(0, 120)}` : ""}`);
        } else setCompareRaw(json as ChartBarsResult);
      })
      .catch((err) => {
        if (!cancelled) {
          setCompareRaw(null);
          setCompareNote(err instanceof Error ? err.message : "Compare failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [compareSymbol, timeframe, adjustment, focusDate, layoutReady]);

  // The comparison line itself: one extra series on the main (percent) scale, replaced when its data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (compareSeriesRef.current) {
      chart.removeSeries(compareSeriesRef.current);
      compareSeriesRef.current = null;
    }
    if (!compareSymbol || compareCandles.length === 0) return;
    const line = chart.addSeries(LineSeries, { color: CHART_CHROME.compare, lineWidth: 2, title: compareSymbol, priceLineVisible: false, lastValueVisible: true });
    line.setData(compareCandles.map((c) => ({ time: toSeconds(c.datetime), value: c.close })));
    compareSeriesRef.current = line;
    refreshLegendRef.current();
  }, [compareCandles, compareSymbol]);

  // Split and dividend events for the same window. Independent of the adjustment choice; failure only means no markers.
  useEffect(() => {
    if (!symbol || assetClass !== "equity") return;
    let cancelled = false;
    const base = `/api/chart-bars?ticker=${encodeURIComponent(symbol)}&timeframe=${timeframe}&events=1`;
    fetch(focusDate ? `${base}&centerDate=${focusDate}` : base)
      .then((res) => (res.ok ? res.json() : null))
      .then((j: { events?: CorporateEvent[]; available?: boolean; reason?: string } | null) => {
        if (cancelled) return;
        setEvents(Array.isArray(j?.events) ? j.events : []);
        setEventsNote(j && j.available === false ? (j.reason ?? "unavailable") : null);
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setEventsNote("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, focusDate, assetClass]);

  // Push candles/volume/SMA20/SMA50 when the data changes. The SMA toggles only show or hide a series (next effect), so
  // clicking one no longer resends all the data or resets the user's zoom (audit F5).
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: toSeconds(c.datetime),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: toSeconds(c.datetime),
        value: c.volume,
        color: c.close >= c.open ? VOLUME_BAR.up : VOLUME_BAR.down,
      }))
    );

    const closes = candles.map((c) => c.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);

    sma20SeriesRef.current?.setData(
      candles
        .map((c, i) => ({ time: toSeconds(c.datetime), value: sma20[i] }))
        .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null)
    );
    sma50SeriesRef.current?.setData(
      candles
        .map((c, i) => ({ time: toSeconds(c.datetime), value: sma50[i] }))
        .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null)
    );

    chartRef.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  useEffect(() => {
    sma20SeriesRef.current?.applyOptions({ visible: showSma20 });
    sma50SeriesRef.current?.applyOptions({ visible: showSma50 });
  }, [candles, showSma20, showSma50]);


  // Real session-boundary markers (Asian/London/New York, UTC — see
  // time-windows.ts's SESSIONS) on intraday forex/futures charts, inferred
  // from the actual bar spacing in the returned data rather than the
  // timeframe preset id, so it self-gates correctly regardless of preset
  // naming. Markers use lightweight-charts v5's real createSeriesMarkers
  // primitive (verified against the installed package's typings — v5
  // removed series.setMarkers() in favor of this plugin-style API).
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const plugin = sessionMarkersRef.current ?? createSeriesMarkers(candleSeries, []);
    sessionMarkersRef.current = plugin;

    type Mark = { time: UTCTimestamp; position: "aboveBar" | "belowBar"; color: string; shape: "circle" | "square"; text: string };
    const markers: Mark[] = [];

    // Split and dividend markers (equities and ETFs): S = split, D = dividend, on the bar of the ex-date.
    if (showEvents && events.length > 0) {
      for (const m of eventsToMarkers(events, candles, etDayKey)) {
        markers.push({
          time: m.time as UTCTimestamp,
          position: m.position,
          color: m.kind === "split" ? CHART_CHROME.split : CHART_CHROME.dividend,
          shape: m.shape === "square" ? "square" : "circle",
          text: m.text,
        });
      }
    }

    // Session boundaries on intraday forex/futures bars, inferred from the real bar spacing (daily+ bars have none).
    const avgSpacingMs = candles.length > 1 ? (candles[candles.length - 1].datetime - candles[0].datetime) / (candles.length - 1) : Infinity;
    if (candles.length >= 2 && (assetClass === "forex" || assetClass === "future") && avgSpacingMs < 20 * 60 * 60 * 1000) {
      const SESSION_MARKS: { id: "asian" | "london" | "newYork"; startMinute: number; color: string; text: string }[] = [
        { id: "asian", startMinute: SESSIONS.ASIAN.start, color: JARVIS.text1, text: "Asian" },
        { id: "london", startMinute: SESSIONS.LONDON.start, color: JARVIS.signal, text: "London" },
        { id: "newYork", startMinute: SESSIONS.NEW_YORK.start, color: JARVIS.verdict, text: "NY" },
      ];
      let prevMinutes: number | null = null;
      for (const c of candles) {
        const { minutesSinceMidnight } = toUtcParts(c.datetime);
        for (const s of SESSION_MARKS) {
          const crossedIntoSession =
            prevMinutes === null ? minutesSinceMidnight === s.startMinute : prevMinutes < s.startMinute && minutesSinceMidnight >= s.startMinute;
          if (crossedIntoSession) markers.push({ time: toSeconds(c.datetime), position: "aboveBar", color: s.color, shape: "circle", text: s.text });
        }
        prevMinutes = minutesSinceMidnight;
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    plugin.setMarkers(markers);
  }, [candles, assetClass, events, showEvents]);

  // Indicators: one IndicatorManager owns the extra series. Toggling an indicator adds or removes only that indicator's
  // series (the others keep their series objects); new candles rebuild the enabled ones. (Audit F3.)
  useEffect(() => {
    managerRef.current?.sync(candles, new Set([...enabledOverlays, ...enabledOscillators]));
    refreshLegendRef.current();
  }, [candles, enabledOverlays, enabledOscillators]);

  // Cost-basis + open-order price lines — the real mechanism behind
  // Webull's "trade on the chart" (confirmed live: it draws lines for held
  // positions/resting orders, not a floating button), using the exact
  // createPriceLine primitive already used above for Volume Profile.
  // Options are excluded (never charted here — see the click-to-trade guard
  // above). Gracefully no-ops if paper trading isn't configured or the
  // account fetch fails — this is contextual chart decoration, not a
  // feature the chart depends on.
  useEffect(() => {
    if (!sessionId || assetClass === "option" || !candleSeriesRef.current) return;
    let cancelled = false;

    fetch(`/api/paper-trading/account?sessionId=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((summary: PaperAccountSummary | null) => {
        if (cancelled || !summary || !candleSeriesRef.current) return;
        const series = candleSeriesRef.current;

        if (positionLineRef.current) {
          series.removePriceLine(positionLineRef.current);
          positionLineRef.current = null;
        }
        for (const line of orderLinesRef.current) series.removePriceLine(line);
        orderLinesRef.current = [];

        const upperSymbol = symbol.trim().toUpperCase();
        const position = summary.positions.find((p) => p.symbol === upperSymbol);
        if (position) {
          positionLineRef.current = series.createPriceLine({
            price: position.avgCostBasis,
            color: JARVIS.verdict,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `Cost Basis ${fmtPx(position.avgCostBasis)}`,
          });
        }

        const openOrders = summary.openOrders.filter((o) => o.symbol === upperSymbol);
        for (const order of openOrders) {
          const price = order.limitPrice ?? order.stopPrice;
          if (price === null || price === undefined) continue;
          orderLinesRef.current.push(
            series.createPriceLine({
              price,
              color: order.side === "buy" ? JARVIS.signal : JARVIS.danger,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `${order.side} ${order.quantity} (${order.orderType.replace("_", " ")})`,
            })
          );
        }
      })
      .catch(() => {
        // Contextual decoration only — silently skip on any failure.
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, symbol, assetClass, candles, positionRefreshKey]);

  return (
    <div className="jarvis" tabIndex={-1} onKeyDown={handleKey} style={{ outline: "none" }}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TIMEFRAME_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => p.alpacaTimeframe && setTimeframe(p.id)}
            disabled={!p.alpacaTimeframe}
            title={p.unavailableReason ?? undefined}
            className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={
              p.id === timeframe
                ? { background: "var(--signal)", color: "var(--ink-950)", borderColor: "var(--signal)", fontWeight: 600 }
                : { borderColor: "var(--line)", color: "var(--text-1)" }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <ChartHeader
        meta={data?.meta ?? null}
        zone={zone}
        intraday={intraday}
        adjustable={data?.meta ? data.meta.provider === "Alpaca" : assetClass === "equity"}
        adjustment={adjustment}
        onAdjustmentChange={setAdjustment}
        loading={loading}
      />

      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--text-1)" }}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSma20} onChange={(e) => setShowSma20(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SMA_COLORS.sma20 }} /> SMA 20
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSma50} onChange={(e) => setShowSma50(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SMA_COLORS.sma50 }} /> SMA 50
        </label>
        {loading && <span style={{ color: "var(--text-2)" }}>Loading…</span>}
        {focusDate && <span style={{ color: "var(--text-2)" }}>Centered on {focusDate}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs" style={{ color: "var(--text-1)" }}>
        <ToggleGroup
          label="Scale"
          name="scale"
          value={scaleMode}
          options={SCALE_MODES.map((m) => ({
            value: m,
            label: SCALE_LABELS[m],
            title: compareActive && m !== "percent" ? "A comparison is on: the chart uses one percent axis. Remove the comparison to change the scale." : SCALE_DESCRIPTIONS[m],
            disabled: compareActive ? m !== "percent" : m === "log" && !(minLow !== null && minLow > 0),
          }))}
          onChange={(m) => {
            setScaleChoice(m);
            saveScaleChoice(m);
          }}
        />
        {assetClass === "equity" && (
          <label className="flex items-center gap-1.5" title={eventsNote ? `Split and dividend markers unavailable: ${eventsNote}` : "S = split, D = dividend (ex-date)"}>
            <input type="checkbox" data-testid="show-events" checked={showEvents} disabled={events.length === 0} onChange={(e) => setShowEvents(e.target.checked)} />
            Splits and dividends{events.length > 0 ? ` (${events.length})` : eventsNote ? " (unavailable)" : " (none in range)"}
          </label>
        )}
        {data?.meta?.provider === "Alpaca" && (
          <label className="flex items-center gap-1.5" title={!intraday ? "Daily and weekly bars have no extended-hours session" : undefined}>
            <input
              type="checkbox"
              data-testid="extended-hours"
              checked={includeExtended}
              disabled={!extendedApplicable || !extendedPresent}
              onChange={(e) => setIncludeExtended(e.target.checked)}
            />
            Extended hours (pre-market 4:00-9:30, after-hours 16:00-20:00 ET)
            {extendedApplicable && !extendedPresent && <span style={{ color: "var(--text-2)" }}> none in this window</span>}
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs" style={{ color: "var(--text-1)" }} data-testid="layout-row">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
            Indicator set
          </span>
          <select
            className="jv-select"
            style={{ padding: "3px 8px", fontSize: 12 }}
            data-testid="preset-select"
            value={matchingPreset(enabledOverlays, enabledOscillators)?.id ?? ""}
            onChange={(e) => {
              const p = presetById(e.target.value);
              if (!p) return;
              setEnabledOverlays(new Set(p.overlays));
              setEnabledOscillators(new Set(p.oscillators));
            }}
            title={matchingPreset(enabledOverlays, enabledOscillators)?.description}
          >
            <option value="">Custom</option>
            {INDICATOR_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border"
          style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}
          data-testid="layout-save"
          title="Remember indicators, scale, timeframe, moving averages and price adjustment in this browser"
          onClick={() => setLayoutNote(saveLayout(currentLayout()) ? "Layout saved in this browser." : "Could not save (browser storage is blocked).")}
        >
          Save layout
        </button>
        <button
          type="button"
          className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border"
          style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}
          data-testid="layout-reset"
          onClick={() => {
            clearLayout();
            setEnabledOverlays(new Set());
            setEnabledOscillators(new Set());
            setScaleChoice(null);
            setShowSma20(true);
            setShowSma50(true);
            setAdjustment("split");
            setIncludeExtended(true);
            if (!focusDate) setTimeframe("1yr");
            setLayoutNote("Saved layout cleared; defaults restored.");
          }}
        >
          Reset layout
        </button>
        {layoutNote && (
          <span role="status" style={{ color: "var(--text-2)" }} data-testid="layout-note">
            {layoutNote}
          </span>
        )}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submitCompare();
          }}
        >
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
              Compare
            </span>
            <input
              className="jv-input"
              style={{ padding: "3px 8px", fontSize: 12, width: 96 }}
              data-testid="compare-input"
              aria-label="Compare with another symbol"
              placeholder="SPY"
              value={compareInput}
              maxLength={12}
              onChange={(e) => setCompareInput(e.target.value)}
            />
          </label>
          <button type="submit" className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border" style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }} data-testid="compare-add">
            Add
          </button>
          {compareSymbol && (
            <button
              type="button"
              className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border"
              style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}
              data-testid="compare-remove"
              onClick={() => {
                setCompareSymbol(null);
                setCompareNote(null);
                setCompareInput("");
              }}
            >
              Remove {compareSymbol}
            </button>
          )}
        </form>
        {compareNote && (
          <span role="status" style={{ color: "var(--verdict)" }} data-testid="compare-note">
            {compareNote}
          </span>
        )}
        <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>

      <DrawingToolbar
        state={drawUi}
        onTool={(t) => drawingRef.current?.setTool(t)}
        onColor={(hex) => drawingRef.current?.setColor(hex)}
        onDelete={() => drawingRef.current?.deleteSelected()}
        onClear={() => drawingRef.current?.clearAll()}
        onCreateAlert={
          onCreateAlert
            ? () => {
                const d = drawingRef.current?.getSelected();
                const last = candlesRef.current[candlesRef.current.length - 1];
                if (d && d.kind === "hline" && last) onCreateAlert({ symbol: symbol.trim().toUpperCase(), price: d.p1.price, direction: d.p1.price >= last.close ? "above" : "below" });
              }
            : undefined
        }
        selectedIsHLine={drawingRef.current?.getSelected()?.kind === "hline"}
        onAddHLineAtLast={() => {
          const last = candlesRef.current[candlesRef.current.length - 1];
          if (last) drawingRef.current?.addHLine(last.close);
        }}
      />

      <details className="mb-3">
        <summary className="text-xs font-medium cursor-pointer select-none" style={{ color: "var(--text-1)" }}>
          Overlays ({enabledOverlays.size} active)
        </summary>
        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "var(--text-1)" }}>
          {OVERLAY_INDICATORS.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5" title={o.description}>
              <input type="checkbox" checked={enabledOverlays.has(o.id)} onChange={() => toggleOverlay(o.id)} />
              {o.label}
              {o.estimate && <span className="jv-badge c-neutral" style={{ padding: "0 5px" }} title={o.estimate}>estimate</span>}
            </label>
          ))}
        </div>
      </details>

      <details className="mb-3">
        <summary className="text-xs font-medium cursor-pointer select-none" style={{ color: "var(--text-1)" }}>
          Oscillators ({enabledOscillators.size} active)
        </summary>
        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "var(--text-1)" }}>
          {OSCILLATOR_INDICATORS.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5" title={o.description}>
              <input type="checkbox" checked={enabledOscillators.has(o.id)} onChange={() => toggleOscillator(o.id)} />
              {o.label}
              {o.estimate && <span className="jv-badge c-neutral" style={{ padding: "0 5px" }} title={o.estimate}>estimate</span>}
            </label>
          ))}
        </div>
      </details>

      {error && (
        <div className="jv-card mb-3" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {assetClass === "option" && (
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Options are traded via the real options chain — see the Options tab&apos;s &quot;Trade Options&quot; sub-tab to pick a
          specific contract.
        </p>
      )}

      <div
        style={{ position: "relative" }}
        tabIndex={0}
        role="group"
        aria-label="Price chart. Press ? for the keyboard shortcuts."
      >
        <div ref={containerRef} style={{ border: "1px solid var(--line)", background: "var(--ink-900)", minHeight: 420 }} />

        <div
          ref={legendRef}
          aria-live="off"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 5,
            background: CHART_CHROME.legendBg,
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "6px 10px",
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--text-1)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            display: "none",
          }}
        />

        {scaleMode !== "linear" && (
          <div
            data-testid="scale-tag"
            style={{
              position: "absolute",
              left: 12,
              top: 64, // under the two-line crosshair legend, inside the price pane
              zIndex: 5,
              background: CHART_CHROME.legendBg,
              border: "1px solid var(--line)",
              padding: "2px 8px",
              fontSize: 10.5,
              fontFamily: "monospace",
              color: "var(--text-1)",
              pointerEvents: "none",
            }}
          >
            {scaleMode === "log" ? "LOG SCALE: equal steps are equal percent moves" : "PERCENT SCALE: change from the first visible bar"}
          </div>
        )}

        {assetClass !== "option" && !readOnly && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5 }}>
            <button
              onClick={() => setFloatingPanelOpen((v) => !v)}
              className="px-4 py-2 text-xs font-semibold uppercase tracking-wide"
              style={{
                borderRadius: 999,
                background: "var(--signal)",
                color: "var(--ink-950)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {floatingPanelOpen ? "✕ Close" : `⚡ Trade ${symbol}`}
            </button>

            {floatingPanelOpen && (
              <div
                className="jv-card"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: "min(90vw, 620px)",
                  maxHeight: "70vh",
                  overflowY: "auto",
                  zIndex: 10,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}
              >
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setFloatingTab("trade")}
                    className={floatingTab === "trade" ? "jv-btn text-xs px-3 py-1" : "jv-btn-outline text-xs px-3 py-1"}
                  >
                    Trade {symbol}
                    {clickedPrice !== undefined ? ` @ ${fmtPx(clickedPrice)}` : ""}
                  </button>
                  {assetClass === "equity" && (
                    <button
                      onClick={() => setFloatingTab("options")}
                      className={floatingTab === "options" ? "jv-btn text-xs px-3 py-1" : "jv-btn-outline text-xs px-3 py-1"}
                    >
                      Options Chain
                    </button>
                  )}
                </div>

                {floatingTab === "trade" && sessionId && (
                  <PaperOrderForm
                    sessionId={sessionId}
                    prefillSymbol={symbol}
                    prefillAssetClass={assetClass}
                    prefillPrice={clickedPrice}
                    compact
                    onFilled={() => setPositionRefreshKey((n) => n + 1)}
                  />
                )}

                {floatingTab === "options" && assetClass === "equity" && <OptionsChainTradeTab initialTicker={symbol} />}
              </div>
            )}
          </div>
        )}
      </div>

      <ActiveLegend
        feed={data?.meta?.feed ?? null}
        adjustment={data?.meta?.adjustment ?? null}
        showSma20={showSma20}
        showSma50={showSma50}
        compareLabel={compareActive ? compareSymbol : null}
        eventLines={showEvents ? events.map((e) => `${new Date(e.dateMs).toISOString().slice(0, 10)} ${e.label}`) : []}
        activeIds={[...INDICATORS.filter((d) => enabledOverlays.has(d.id) || enabledOscillators.has(d.id)).map((d) => d.id)]}
      />

      {volumeProfileSummary && volumeProfileSummary.poc !== null && (
        <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
          Volume Profile (estimate: approximated from OHLCV bars, not true tick-level data) — POC{" "}
          {volumeProfileSummary.poc.toFixed(2)}, Value Area {volumeProfileSummary.val?.toFixed(2)}–
          {volumeProfileSummary.vah?.toFixed(2)}.
        </p>
      )}

      {data && data.dataLimitations.length > 0 && (
        <div className="mt-3 space-y-2">
          {data.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
              <div className="text-xs" style={{ color: "var(--verdict)" }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
        18 retail/OHLCV-based indicators available above. Institutional
        microstructure indicators (CVD, Footprint/Cluster charts, Liquidity
        Heatmaps, Iceberg detectors) need Level 2 order-book depth or
        bid/ask-tagged tick data, which no free source provides — the
        realistic paid option researched is Databento (~$179/mo+), not
        wired in.
      </p>
    </div>
  );
}
