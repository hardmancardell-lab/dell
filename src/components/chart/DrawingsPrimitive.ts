// Series primitive that renders the user's drawings (horizontal line, trend line, rectangle) on the main pane and answers
// hit tests for the DrawingController. Drawings are stored in data coordinates (time, price); pixel positions are
// recomputed on every draw, so zoom, pan, resize and scale-mode changes need no bookkeeping.
import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { barIndexToTime, hitGeometry, timeToBarIndex, type AnchorPoint, type Drawing, type HitPart, type PixelGeometry } from "@/lib/chart/drawings";
import { CHART_CHROME, withAlpha } from "@/lib/chart/colors";
import { JARVIS } from "@/lib/design/tokens";

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawings: readonly Drawing[] = [];
  private selectedId: string | null = null;
  private preview: Drawing | null = null;
  private times: readonly number[] = [];
  private fmt: (v: number) => string = (v) => v.toFixed(2);
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: CanvasRenderingTarget2D) => {
        if (!this.chart || !this.series) return;
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const paint = (d: Drawing, selected: boolean, ghost: boolean) => {
            const g = this.geometry(d, mediaSize.width);
            if (!g) return;
            ctx.save();
            ctx.strokeStyle = d.color;
            ctx.fillStyle = d.color;
            ctx.lineWidth = selected ? 2.5 : 1.5;
            ctx.globalAlpha = ghost ? 0.7 : 1;
            if (ghost) ctx.setLineDash([5, 4]);
            if (d.kind === "hline") {
              ctx.beginPath();
              ctx.moveTo(0, g.y1);
              ctx.lineTo(mediaSize.width, g.y1);
              ctx.stroke();
              ctx.font = "11px monospace";
              ctx.textAlign = "right";
              ctx.fillText(this.fmt(d.p1.price), mediaSize.width - 6, g.y1 - 4);
            } else if (d.kind === "trend") {
              ctx.beginPath();
              ctx.moveTo(g.x1, g.y1);
              ctx.lineTo(g.x2, g.y2);
              ctx.stroke();
            } else {
              const l = Math.min(g.x1, g.x2), t = Math.min(g.y1, g.y2);
              const w = Math.abs(g.x2 - g.x1), h = Math.abs(g.y2 - g.y1);
              ctx.fillStyle = withAlpha(d.color, 0.12);
              ctx.fillRect(l, t, w, h);
              ctx.strokeRect(l, t, w, h);
            }
            if (selected) {
              ctx.setLineDash([]);
              ctx.fillStyle = JARVIS.ink900;
              ctx.strokeStyle = CHART_CHROME.selection;
              ctx.lineWidth = 1.5;
              const handles = d.kind === "hline" ? [[mediaSize.width - 24, g.y1]] : [[g.x1, g.y1], [g.x2, g.y2]];
              for (const [hx, hy] of handles) {
                ctx.fillRect(hx - 4, hy - 4, 8, 8);
                ctx.strokeRect(hx - 4, hy - 4, 8, 8);
              }
            }
            ctx.restore();
          };
          for (const d of this.drawings) paint(d, d.id === this.selectedId, false);
          if (this.preview) paint(this.preview, false, true);
        });
      },
    };
    this.view = { zOrder: () => "top", renderer: () => renderer };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  setState(drawings: readonly Drawing[], selectedId: string | null, preview: Drawing | null, times: readonly number[], fmt: (v: number) => string): void {
    this.drawings = drawings;
    this.selectedId = selectedId;
    this.preview = preview;
    this.times = times;
    this.fmt = fmt;
    this.requestUpdate?.();
  }

  // -- conversions (whole-number logical indexes only: fractional ones convert to 0 in this library version)

  private logicalX(idx: number): number | null {
    const ts = this.chart?.timeScale();
    if (!ts) return null;
    const i = Math.floor(idx);
    const c0 = ts.logicalToCoordinate(i as never);
    const c1 = ts.logicalToCoordinate((i + 1) as never);
    if (c0 === null || c1 === null) return null;
    return c0 + (idx - i) * (c1 - c0);
  }

  timeToX(sec: number): number | null {
    const idx = timeToBarIndex(this.times, sec);
    return idx === null ? null : this.logicalX(idx);
  }

  xToTime(x: number): number | null {
    const logical = this.chart?.timeScale().coordinateToLogical(x);
    if (logical === null || logical === undefined) return null;
    return barIndexToTime(this.times, logical as number);
  }

  /** Data coordinates under a pixel (null when the chart cannot say, for example with no data). */
  anchorAt(x: number, y: number): AnchorPoint | null {
    const time = this.xToTime(x);
    const price = this.series?.coordinateToPrice(y);
    if (time === null || price === null || price === undefined || !Number.isFinite(price)) return null;
    return { time, price: price as number };
  }

  geometry(d: Drawing, width: number): PixelGeometry | null {
    const series = this.series;
    if (!series) return null;
    const y1 = series.priceToCoordinate(d.p1.price);
    if (y1 === null) return null;
    if (d.kind === "hline") return { kind: "hline", x1: 0, y1, x2: width, y2: y1, width };
    if (!d.p2) return null;
    const y2 = series.priceToCoordinate(d.p2.price);
    const x1 = this.timeToX(d.p1.time);
    const x2 = this.timeToX(d.p2.time);
    if (y2 === null || x1 === null || x2 === null) return null;
    return { kind: d.kind, x1, y1, x2, y2, width };
  }

  /** Topmost drawing under the pointer, with which part of it. `width` is the plot width in CSS pixels. */
  hit(x: number, y: number, width: number): { id: string; part: HitPart } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const g = this.geometry(d, width);
      if (!g) continue;
      const part = hitGeometry(g, x, y);
      if (part) return { id: d.id, part };
    }
    return null;
  }
}
