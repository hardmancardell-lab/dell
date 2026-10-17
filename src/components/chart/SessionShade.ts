// Series primitive that shades time ranges behind the candles (used for the pre-market and after-hours session).
// Ranges are given as bar open times in epoch seconds; the shading covers whole bars (half a bar either side).
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export interface ShadeSeconds {
  fromSec: number;
  toSec: number;
}

export class SessionShade implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private ranges: ShadeSeconds[] = [];
  private color: string;
  private view: IPrimitivePaneView;
  /** Pixel rectangles from the latest updateAllViews. */
  private rects: { x0: number; x1: number }[] = [];

  constructor(color: string) {
    this.color = color;
    const self = this;
    const renderer: IPrimitivePaneRenderer = {
      draw() {},
      drawBackground(target: CanvasRenderingTarget2D) {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          context.fillStyle = self.color;
          for (const r of self.rects) context.fillRect(r.x0, 0, Math.max(1, r.x1 - r.x0), mediaSize.height);
        });
      },
    };
    this.view = { zOrder: () => "bottom", renderer: () => renderer };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.rects = [];
  }

  setRanges(ranges: ShadeSeconds[]): void {
    this.ranges = ranges;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    const chart = this.chart;
    if (!chart) {
      this.rects = [];
      return;
    }
    const ts = chart.timeScale();
    const out: { x0: number; x1: number }[] = [];
    for (const r of this.ranges) {
      const i0 = ts.timeToIndex(r.fromSec as unknown as Time, true);
      const i1 = ts.timeToIndex(r.toSec as unknown as Time, true);
      if (i0 === null || i1 === null) continue;
      const x0 = ts.logicalToCoordinate((i0 - 0.5) as never);
      const x1 = ts.logicalToCoordinate((i1 + 0.5) as never);
      if (x0 === null || x1 === null) continue;
      out.push({ x0, x1 });
    }
    this.rects = out;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
}
