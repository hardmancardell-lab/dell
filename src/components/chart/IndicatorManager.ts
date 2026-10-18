// Owns the indicator series on a lightweight-charts instance. Each enabled indicator is one entry (its series, its price
// lines, its pane). Toggling an indicator adds or removes ONLY that entry; every other indicator's series objects are
// kept as they are (audit F3: the old effect removed and rebuilt all of them on every click). Changing the candles
// rebuilds every enabled indicator, because their values change.
import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { MarketCandle } from "@/lib/data/market-data-types";
import { OSC_HIST } from "@/lib/design/tokens";
import { computeIndicator, indicatorDef, INDICATORS, type SeriesSpec } from "@/lib/chart/indicators";
import type { VolumeProfileResult } from "@/lib/agents/trading-agent/skills/technical-indicators";

const LINE_STYLES = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

interface Entry {
  series: ISeriesApi<SeriesType>[];
  lines: IPriceLine[];
  /** Pane the series were created in (oscillators only; overlays live in pane 0). */
  oscillator: boolean;
}

export interface IndicatorStats {
  /** Series created over the manager's life. A toggle of one indicator raises this by that indicator's series count only. */
  seriesCreated: number;
  seriesRemoved: number;
  /** Times an indicator was computed. */
  computed: number;
  /** Full rebuilds caused by new candles. */
  rebuilds: number;
}

export class IndicatorManager {
  readonly stats: IndicatorStats = { seriesCreated: 0, seriesRemoved: 0, computed: 0, rebuilds: 0 };
  private readonly entries = new Map<string, Entry>();
  private candles: readonly MarketCandle[] | null = null;
  private times: UTCTimestamp[] = [];

  constructor(
    private readonly chart: IChartApi,
    private readonly candleSeries: ISeriesApi<"Candlestick">,
    private readonly opts: {
      baseHeight: number;
      paneHeight: number;
      /** Called with the volume-profile summary when that overlay is on, null when off. */
      onProfile?: (summary: VolumeProfileResult | null) => void;
    }
  ) {}

  /** Ids currently drawn. */
  active(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * One readout per drawn indicator, for the crosshair legend. `valueOf` gives a series' value at the cursor bar (or its
   * newest value); histogram series (the MACD bars) are skipped so a readout is the lines only.
   */
  readouts(valueOf: (s: ISeriesApi<SeriesType>) => number | null): { id: string; label: string; values: (number | null)[] }[] {
    const out: { id: string; label: string; values: (number | null)[] }[] = [];
    for (const def of INDICATORS) {
      const e = this.entries.get(def.id);
      if (!e || e.series.length === 0) continue;
      const lines = e.series.filter((x) => x.seriesType() !== "Histogram");
      if (lines.length === 0) continue;
      out.push({ id: def.id, label: def.label.replace(/ \(.*\)$/, ""), values: lines.map((x) => valueOf(x)) });
    }
    return out;
  }

  /** Series of one indicator (for tests and the legend). */
  seriesOf(id: string): ISeriesApi<SeriesType>[] {
    return this.entries.get(id)?.series ?? [];
  }

  /**
   * Brings the chart to the given state. New candle array (by reference) means rebuild everything enabled; otherwise only
   * the difference between the drawn ids and `enabled` is added or removed.
   */
  sync(candles: readonly MarketCandle[], enabled: ReadonlySet<string>): void {
    const dataChanged = candles !== this.candles;
    if (dataChanged) {
      for (const id of [...this.entries.keys()]) this.remove(id);
      this.candles = candles;
      this.times = candles.map((c) => Math.floor(c.datetime / 1000) as UTCTimestamp);
      this.stats.rebuilds += 1;
    } else {
      for (const id of [...this.entries.keys()]) if (!enabled.has(id)) this.remove(id);
    }
    this.tidyPanes(); // drop panes emptied by the removals before new ones are numbered
    // Canonical order, so panes are created in a predictable order on a rebuild.
    for (const def of INDICATORS) {
      if (enabled.has(def.id) && !this.entries.has(def.id)) this.add(def.id);
    }
    this.tidyPanes();
    this.opts.onProfile?.(this.profile ?? null);
  }

  private profile: VolumeProfileResult | undefined;

  private add(id: string): void {
    const candles = this.candles as MarketCandle[];
    const def = indicatorDef(id);
    if (!def || candles.length === 0) return;
    const out = computeIndicator(id, candles);
    this.stats.computed += 1;
    const oscillator = def.group === "oscillator";
    const pane = oscillator ? this.chart.panes().length : 0;
    const entry: Entry = { series: [], lines: [], oscillator };
    for (const spec of out.series) entry.series.push(this.addSpec(spec, pane));
    for (const lv of out.levels) {
      entry.lines.push(
        this.candleSeries.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: lv.width,
          lineStyle: lv.style === "solid" ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: lv.title,
        })
      );
    }
    if (id === "volumeProfile") this.profile = out.summary;
    this.entries.set(id, entry);
  }

  private addSpec(spec: SeriesSpec, pane: number): ISeriesApi<SeriesType> {
    const times = this.times;
    this.stats.seriesCreated += 1;
    if (spec.kind === "histogram") {
      const s = this.chart.addSeries(HistogramSeries, {}, pane);
      const pts: { time: UTCTimestamp; value: number; color: string }[] = [];
      spec.values.forEach((v, i) => {
        if (v !== null && Number.isFinite(v)) pts.push({ time: times[i], value: v, color: v >= 0 ? OSC_HIST.up : OSC_HIST.down });
      });
      s.setData(pts);
      return s;
    }
    const s = this.chart.addSeries(
      LineSeries,
      {
        color: spec.color,
        lineWidth: 1,
        ...(spec.style ? { lineStyle: LINE_STYLES[spec.style] } : {}),
        ...(spec.pointsOnly ? { lineVisible: false, pointMarkersVisible: true } : {}),
      },
      pane
    );
    const pts: { time: UTCTimestamp; value: number }[] = [];
    spec.values.forEach((v, i) => {
      if (v !== null && Number.isFinite(v)) pts.push({ time: times[i], value: v });
    });
    s.setData(pts);
    return s;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const s of entry.series) {
      this.chart.removeSeries(s);
      this.stats.seriesRemoved += 1;
    }
    for (const l of entry.lines) this.candleSeries.removePriceLine(l);
    this.entries.delete(id);
    if (id === "volumeProfile") this.profile = undefined;
  }

  /** Drops panes left empty by a removal and sets the chart height from the pane count. */
  private tidyPanes(): void {
    const panes = this.chart.panes();
    for (let i = panes.length - 1; i >= 1; i--) {
      if (this.chart.panes()[i]?.getSeries().length === 0) this.chart.removePane(i);
    }
    this.chart.applyOptions({ height: this.opts.baseHeight + (this.chart.panes().length - 1) * this.opts.paneHeight });
  }

  /** Removes everything this manager drew (call before the chart is disposed or when the manager is replaced). */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.candles = null;
  }
}
