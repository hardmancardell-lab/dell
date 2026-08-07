"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
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
import { PaperOrderForm } from "./PaperOrderForm";
import { OptionsChainTradeTab } from "./OptionsChainTradeTab";
import type { AssetClass, PaperAccountSummary } from "@/lib/agents/trading-agent/types";
import {
  atr,
  bollingerBands,
  cci,
  cmf,
  ema,
  hma,
  ichimoku,
  keltnerChannels,
  macd,
  obv,
  parabolicSar,
  roc,
  rsi,
  sma,
  stochastic,
  volumeProfile,
  vwapWithBands,
  williamsR,
  type VolumeProfileResult,
} from "@/lib/agents/trading-agent/skills/technical-indicators";

function toSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

interface OverlayDef {
  id: string;
  label: string;
}

interface OscillatorDef {
  id: string;
  label: string;
}

// Fixed canonical order — also determines oscillator pane assignment order.
const OVERLAY_INDICATORS: OverlayDef[] = [
  { id: "ema20", label: "EMA 20" },
  { id: "ema50", label: "EMA 50" },
  { id: "bollinger", label: "Bollinger Bands (20, 2σ)" },
  { id: "keltner", label: "Keltner Channels" },
  { id: "psar", label: "Parabolic SAR" },
  { id: "hma", label: "Hull MA (9)" },
  { id: "ichimoku", label: "Ichimoku Kinko Hyo" },
  { id: "vwap", label: "VWAP + Bands" },
  { id: "volumeProfile", label: "Volume Profile (approx.)" },
];

const OSCILLATOR_INDICATORS: OscillatorDef[] = [
  { id: "rsi", label: "RSI (14)" },
  { id: "stochastic", label: "Stochastic (14, 3)" },
  { id: "cci", label: "CCI (20)" },
  { id: "roc", label: "ROC (12)" },
  { id: "williamsR", label: "Williams %R (14)" },
  { id: "macd", label: "MACD (12, 26, 9)" },
  { id: "atr", label: "ATR (14)" },
  { id: "obv", label: "OBV" },
  { id: "cmf", label: "CMF (20)" },
];

const COLORS = {
  ema20: "#8b5cf6",
  ema50: "#ec4899",
  bollinger: "#06b6d4",
  keltner: "#f97316",
  psar: "#eab308",
  hma: "#14b8a6",
  ichimokuTenkan: "#3b82f6",
  ichimokuKijun: "#ef4444",
  ichimokuSpanA: "#22c55e",
  ichimokuSpanB: "#f43f5e",
  ichimokuChikou: "#a855f7",
  vwap: "#0ea5e9",
  volumeProfile: "#84cc16",
  rsi: "#3b82f6",
  stochK: "#3b82f6",
  stochD: "#f59e0b",
  cci: "#8b5cf6",
  roc: "#14b8a6",
  williamsR: "#ec4899",
  macdLine: "#3b82f6",
  macdSignal: "#f59e0b",
  atr: "#f97316",
  obv: "#06b6d4",
  cmf: "#84cc16",
};

// The jarvis palette's real hex values (globals.css .jarvis custom
// properties) — lightweight-charts renders on canvas and can't resolve
// var(--...) itself, so the chart's own theme is kept in sync by hand here.
const JARVIS = {
  inkBg: "#0e131b", // --ink-900
  line: "#223040", // --line
  text1: "#9fb0c4", // --text-1
  signal: "#4fe8d0", // --signal — also this chart's candle up-color
  danger: "#e8637a", // --danger — also this chart's candle down-color
  verdict: "#f0a868", // --verdict — cost-basis line
};

export function PriceChart({ symbol, focusDate, assetClass = "equity" }: { symbol: string; focusDate?: string; assetClass?: AssetClass }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const extraPriceLinesRef = useRef<IPriceLine[]>([]);
  const positionLineRef = useRef<IPriceLine | null>(null);
  const orderLinesRef = useRef<IPriceLine[]>([]);
  const sessionMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const assetClassRef = useRef<AssetClass>(assetClass);
  assetClassRef.current = assetClass;

  // 1mo (1-day candles, ~1 month lookback) gives useful before/after context
  // around a single occurrence date without pulling a whole year of noise.
  const [timeframe, setTimeframe] = useState(focusDate ? "1mo" : "1yr");
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [enabledOverlays, setEnabledOverlays] = useState<Set<string>>(new Set());
  const [enabledOscillators, setEnabledOscillators] = useState<Set<string>>(new Set());
  const [volumeProfileSummary, setVolumeProfileSummary] = useState<VolumeProfileResult | null>(null);
  const [data, setData] = useState<ChartBarsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(false);
  const [floatingTab, setFloatingTab] = useState<"trade" | "options">("trade");
  const [clickedPrice, setClickedPrice] = useState<number | undefined>(undefined);
  const [positionRefreshKey, setPositionRefreshKey] = useState(0);

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

  // Chart lifecycle: create once per mount, dispose on unmount. Single fixed
  // dark theme (jarvis is dark-only by design, no light/OS-preference fork).
  useEffect(() => {
    if (!containerRef.current) return;

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
      timeScale: { timeVisible: true, secondsVisible: false },
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

    const sma20Series = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1 });
    const sma50Series = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1 });

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
      if (assetClassRef.current === "option" || !param.time) return;
      const barData = candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : undefined;
      const price = barData && "close" in barData ? (barData as { close: number }).close : undefined;
      setClickedPrice(price);
      setFloatingTab("trade");
      setFloatingPanelOpen(true);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      extraSeriesRef.current = [];
      extraPriceLinesRef.current = [];
      positionLineRef.current = null;
      orderLinesRef.current = [];
    };
  }, []);

  // Fetch on symbol/timeframe change.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = focusDate
      ? `/api/chart-bars?ticker=${encodeURIComponent(symbol)}&timeframe=${timeframe}&centerDate=${focusDate}`
      : `/api/chart-bars?ticker=${encodeURIComponent(symbol)}&timeframe=${timeframe}`;

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
  }, [symbol, timeframe, focusDate]);

  // Push candles/volume/SMA20/SMA50 whenever data or those two toggles change.
  useEffect(() => {
    if (!data || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = data.candles;
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
        color: c.close >= c.open ? "rgba(79,232,208,0.5)" : "rgba(232,99,122,0.5)",
      }))
    );

    const closes = candles.map((c) => c.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);

    sma20SeriesRef.current?.setData(
      showSma20
        ? candles
            .map((c, i) => ({ time: toSeconds(c.datetime), value: sma20[i] }))
            .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null)
        : []
    );
    sma50SeriesRef.current?.setData(
      showSma50
        ? candles
            .map((c, i) => ({ time: toSeconds(c.datetime), value: sma50[i] }))
            .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null)
        : []
    );

    chartRef.current?.timeScale().fitContent();
  }, [data, showSma20, showSma50]);

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

    const candles = data?.candles ?? [];
    if (candles.length < 2 || (assetClass !== "forex" && assetClass !== "future")) {
      plugin.setMarkers([]);
      return;
    }
    const avgSpacingMs = (candles[candles.length - 1].datetime - candles[0].datetime) / (candles.length - 1);
    if (avgSpacingMs >= 20 * 60 * 60 * 1000) {
      plugin.setMarkers([]); // daily+ bars — session boundaries within a bar aren't meaningful
      return;
    }

    const SESSION_MARKS: { id: "asian" | "london" | "newYork"; startMinute: number; color: string; text: string }[] = [
      { id: "asian", startMinute: SESSIONS.ASIAN.start, color: JARVIS.text1, text: "Asian" },
      { id: "london", startMinute: SESSIONS.LONDON.start, color: JARVIS.signal, text: "London" },
      { id: "newYork", startMinute: SESSIONS.NEW_YORK.start, color: JARVIS.verdict, text: "NY" },
    ];
    let prevMinutes: number | null = null;
    const markers: { time: UTCTimestamp; position: "aboveBar"; color: string; shape: "circle"; text: string }[] = [];
    for (const c of candles) {
      const { minutesSinceMidnight } = toUtcParts(c.datetime);
      for (const s of SESSION_MARKS) {
        const crossedIntoSession =
          prevMinutes === null
            ? minutesSinceMidnight === s.startMinute
            : prevMinutes < s.startMinute && minutesSinceMidnight >= s.startMinute;
        if (crossedIntoSession) {
          markers.push({ time: toSeconds(c.datetime), position: "aboveBar", color: s.color, shape: "circle", text: s.text });
        }
      }
      prevMinutes = minutesSinceMidnight;
    }
    plugin.setMarkers(markers);
  }, [data, assetClass]);

  // Rebuild every "extra" overlay/oscillator series from scratch whenever the
  // data or the enabled-indicator sets change — simpler and less error-prone
  // than incrementally diffing pane indices as toggles change.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || !data) return;

    for (const s of extraSeriesRef.current) chart.removeSeries(s);
    extraSeriesRef.current = [];
    for (const line of extraPriceLinesRef.current) candleSeries.removePriceLine(line);
    extraPriceLinesRef.current = [];
    const paneCount = chart.panes().length;
    for (let i = paneCount - 1; i >= 1; i--) chart.removePane(i);

    const candles = data.candles;
    const closes = candles.map((c) => c.close);
    const times = candles.map((c) => toSeconds(c.datetime));

    function addLine(
      values: (number | null)[],
      color: string,
      paneIndex = 0,
      extraOpts: Record<string, unknown> = {}
    ) {
      const series = chart!.addSeries(LineSeries, { color, lineWidth: 1, ...extraOpts }, paneIndex);
      const points = values
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter((p): p is { time: UTCTimestamp; value: number } => p !== null);
      series.setData(points);
      extraSeriesRef.current.push(series);
      return series;
    }

    function addHistogram(values: (number | null)[], paneIndex: number) {
      const series = chart!.addSeries(HistogramSeries, {}, paneIndex);
      const points = values
        .map((v, i) =>
          v !== null
            ? { time: times[i], value: v, color: v >= 0 ? "rgba(79,232,208,0.6)" : "rgba(232,99,122,0.6)" }
            : null
        )
        .filter((p): p is { time: UTCTimestamp; value: number; color: string } => p !== null);
      series.setData(points);
      extraSeriesRef.current.push(series);
    }

    // --- Overlays (pane 0) ---
    if (enabledOverlays.has("ema20")) addLine(ema(closes, 20), COLORS.ema20);
    if (enabledOverlays.has("ema50")) addLine(ema(closes, 50), COLORS.ema50);
    if (enabledOverlays.has("bollinger")) {
      const bb = bollingerBands(closes);
      addLine(bb.upper, COLORS.bollinger, 0, { lineStyle: LineStyle.Dashed });
      addLine(bb.lower, COLORS.bollinger, 0, { lineStyle: LineStyle.Dashed });
    }
    if (enabledOverlays.has("keltner")) {
      const kc = keltnerChannels(candles);
      addLine(kc.upper, COLORS.keltner, 0, { lineStyle: LineStyle.Dashed });
      addLine(kc.lower, COLORS.keltner, 0, { lineStyle: LineStyle.Dashed });
    }
    if (enabledOverlays.has("psar")) {
      addLine(parabolicSar(candles), COLORS.psar, 0, { lineVisible: false, pointMarkersVisible: true });
    }
    if (enabledOverlays.has("hma")) addLine(hma(closes, 9), COLORS.hma);
    if (enabledOverlays.has("ichimoku")) {
      const ich = ichimoku(candles);
      addLine(ich.tenkan, COLORS.ichimokuTenkan);
      addLine(ich.kijun, COLORS.ichimokuKijun);
      addLine(ich.spanA, COLORS.ichimokuSpanA, 0, { lineStyle: LineStyle.Dotted });
      addLine(ich.spanB, COLORS.ichimokuSpanB, 0, { lineStyle: LineStyle.Dotted });
      addLine(ich.chikou, COLORS.ichimokuChikou, 0, { lineStyle: LineStyle.Dashed });
    }
    if (enabledOverlays.has("vwap")) {
      const vb = vwapWithBands(candles);
      addLine(vb.vwap, COLORS.vwap);
      addLine(vb.upper, COLORS.vwap, 0, { lineStyle: LineStyle.Dashed });
      addLine(vb.lower, COLORS.vwap, 0, { lineStyle: LineStyle.Dashed });
    }
    if (enabledOverlays.has("volumeProfile")) {
      const vp = volumeProfile(candles);
      setVolumeProfileSummary(vp);
      if (vp.poc !== null) {
        extraPriceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: vp.poc,
            color: COLORS.volumeProfile,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: "POC",
          })
        );
      }
      if (vp.vah !== null) {
        extraPriceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: vp.vah,
            color: COLORS.volumeProfile,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "VAH",
          })
        );
      }
      if (vp.val !== null) {
        extraPriceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: vp.val,
            color: COLORS.volumeProfile,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "VAL",
          })
        );
      }
    } else {
      setVolumeProfileSummary(null);
    }

    // --- Oscillators (own pane each, assigned in canonical order) ---
    let nextPane = 1;
    for (const osc of OSCILLATOR_INDICATORS) {
      if (!enabledOscillators.has(osc.id)) continue;
      const pane = nextPane++;
      switch (osc.id) {
        case "rsi":
          addLine(rsi(closes), COLORS.rsi, pane);
          break;
        case "stochastic": {
          const st = stochastic(candles);
          addLine(st.k, COLORS.stochK, pane);
          addLine(st.d, COLORS.stochD, pane);
          break;
        }
        case "cci":
          addLine(cci(candles), COLORS.cci, pane);
          break;
        case "roc":
          addLine(roc(closes), COLORS.roc, pane);
          break;
        case "williamsR":
          addLine(williamsR(candles), COLORS.williamsR, pane);
          break;
        case "macd": {
          const m = macd(closes);
          addHistogram(m.histogram, pane);
          addLine(m.macd, COLORS.macdLine, pane);
          addLine(m.signal, COLORS.macdSignal, pane);
          break;
        }
        case "atr":
          addLine(atr(candles), COLORS.atr, pane);
          break;
        case "obv":
          addLine(obv(candles), COLORS.obv, pane);
          break;
        case "cmf":
          addLine(cmf(candles), COLORS.cmf, pane);
          break;
      }
    }

    chart.applyOptions({ height: 420 + (nextPane - 1) * 150 });
  }, [data, enabledOverlays, enabledOscillators]);

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
            title: `Cost Basis ${position.avgCostBasis.toFixed(2)}`,
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
  }, [sessionId, symbol, assetClass, data, positionRefreshKey]);

  return (
    <div className="jarvis">
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

      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--text-1)" }}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSma20} onChange={(e) => setShowSma20(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#3b82f6" }} /> SMA 20
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSma50} onChange={(e) => setShowSma50(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#f59e0b" }} /> SMA 50
        </label>
        {loading && <span style={{ color: "var(--text-2)" }}>Loading…</span>}
        {focusDate && <span style={{ color: "var(--text-2)" }}>Centered on {focusDate}</span>}
      </div>

      <details className="mb-3">
        <summary className="text-xs font-medium cursor-pointer select-none" style={{ color: "var(--text-1)" }}>
          Overlays ({enabledOverlays.size} active)
        </summary>
        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "var(--text-1)" }}>
          {OVERLAY_INDICATORS.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={enabledOverlays.has(o.id)} onChange={() => toggleOverlay(o.id)} />
              {o.label}
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
            <label key={o.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={enabledOscillators.has(o.id)} onChange={() => toggleOscillator(o.id)} />
              {o.label}
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

      <div style={{ position: "relative" }}>
        <div ref={containerRef} style={{ border: "1px solid var(--line)", background: "var(--ink-900)" }} />

        {assetClass !== "option" && (
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
                    {clickedPrice !== undefined ? ` @ ${clickedPrice.toFixed(2)}` : ""}
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

      {volumeProfileSummary && volumeProfileSummary.poc !== null && (
        <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
          Volume Profile (approximated from OHLCV bars, not true tick-level data) — POC{" "}
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
