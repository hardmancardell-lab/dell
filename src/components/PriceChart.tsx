"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAME_PRESETS } from "@/lib/agents/trading-agent/skills/timeframe-presets";
import type { ChartBarsResult } from "@/lib/agents/trading-agent/skills/chart-bars";
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

export function PriceChart({ symbol, focusDate }: { symbol: string; focusDate?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const extraPriceLinesRef = useRef<IPriceLine[]>([]);

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

  // Chart lifecycle: create once per mount, dispose on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const isDark = document.documentElement.classList.contains("dark") ||
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#71717a",
      },
      grid: {
        vertLines: { color: isDark ? "#27272a" : "#e4e4e7" },
        horzLines: { color: isDark ? "#27272a" : "#e4e4e7" },
      },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
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
        color: c.close >= c.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
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
            ? { time: times[i], value: v, color: v >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)" }
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

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TIMEFRAME_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => p.alpacaTimeframe && setTimeframe(p.id)}
            disabled={!p.alpacaTimeframe}
            title={p.unavailableReason ?? undefined}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              p.id === timeframe
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                : p.alpacaTimeframe
                  ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  : "bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-700 cursor-not-allowed"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-3 text-xs">
        <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={showSma20} onChange={(e) => setShowSma20(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> SMA 20
        </label>
        <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={showSma50} onChange={(e) => setShowSma50(e.target.checked)} />
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> SMA 50
        </label>
        {loading && <span className="text-zinc-400">Loading…</span>}
        {focusDate && <span className="text-zinc-400">Centered on {focusDate}</span>}
      </div>

      <details className="mb-3">
        <summary className="text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          Overlays ({enabledOverlays.size} active)
        </summary>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {OVERLAY_INDICATORS.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={enabledOverlays.has(o.id)}
                onChange={() => toggleOverlay(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </details>

      <details className="mb-3">
        <summary className="text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          Oscillators ({enabledOscillators.size} active)
        </summary>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {OSCILLATOR_INDICATORS.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={enabledOscillators.has(o.id)}
                onChange={() => toggleOscillator(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </details>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-3">
          {error}
        </div>
      )}

      <div ref={containerRef} className="rounded-xl border border-zinc-200 dark:border-zinc-800" />

      {volumeProfileSummary && volumeProfileSummary.poc !== null && (
        <p className="text-xs text-zinc-500 mt-2">
          Volume Profile (approximated from OHLCV bars, not true tick-level data) — POC{" "}
          {volumeProfileSummary.poc.toFixed(2)}, Value Area {volumeProfileSummary.val?.toFixed(2)}–
          {volumeProfileSummary.vah?.toFixed(2)}.
        </p>
      )}

      {data && data.dataLimitations.length > 0 && (
        <div className="mt-3 space-y-2">
          {data.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-400 mt-3">
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
