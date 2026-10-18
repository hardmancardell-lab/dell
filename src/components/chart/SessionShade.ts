// Series primitive that shades time ranges behind the candles (used for the pre-market and after-hours session).
// Ranges are given as bar open times in epoch seconds; the shading covers whole bars (half a bar either side).
// Pixel positions are computed inside draw(): the time scale's coordinate conversion is only reliable at render time
// (calling it from updateAllViews returned 0 for every position).
import type {
  IChartApi,
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
  private requestUpdate: (() => void) | null = null;
  private ranges: ShadeSeconds[] = [];
  private readonly color: string;
  private readonly view: IPrimitivePaneView;

  constructor(color: string) {
    this.color = color;
    const renderer: IPrimitivePaneRenderer = {
      // zOrder "bottom" layers are painted through draw(), behind the candles.
      draw: (target: CanvasRenderingTarget2D) => {
        const chart = this.chart;
        if (!chart || this.ranges.length === 0) return;
        const ts = chart.timeScale();
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          context.fillStyle = this.color;
          for (const r of this.ranges) {
            const i0 = ts.timeToIndex(r.fromSec as unknown as Time, true);
            const i1 = ts.timeToIndex(r.toSec as unknown as Time, true);
            if (i0 === null || i1 === null) continue;
            // Whole-number logical indexes only: fractional ones convert to 0 in this library version.
            const c0 = ts.logicalToCoordinate(i0 as never);
            const c1 = ts.logicalToCoordinate(i1 as never);
            const cNext = ts.logicalToCoordinate((i0 + 1) as never);
            if (c0 === null || c1 === null) continue;
            const half = cNext !== null ? Math.abs(cNext - c0) / 2 : 2;
            const x0 = c0 - half;
            const x1 = c1 + half;
            if (x1 < 0 || x0 > mediaSize.width) continue;
            context.fillRect(x0, 0, Math.max(1, x1 - x0), mediaSize.height);
          }
        });
      },
    };
    this.view = { zOrder: () => "bottom", renderer: () => renderer };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  setRanges(ranges: ShadeSeconds[]): void {
    this.ranges = ranges;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
}
