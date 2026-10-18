// Interaction for chart drawings: create (click, or click-click for two-point shapes), select, drag to move, drag a handle
// to resize, delete, clear all, keyboard nudges. Owns the drawing list and tells the host (React) when it changes, so the
// host can persist it. Mouse and touch are both handled; while a drawing is being created or dragged the event is
// consumed in the capture phase so the chart does not pan underneath it.
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import {
  keyboardPriceStep,
  moveEndpoint,
  newDrawingId,
  snapToBar,
  translateDrawing,
  MAX_DRAWINGS,
  type AnchorPoint,
  type Drawing,
  type DrawingKind,
  type HitPart,
} from "@/lib/chart/drawings";
import { DEFAULT_DRAWING_COLOR } from "@/lib/chart/colors";
import { DrawingsPrimitive } from "./DrawingsPrimitive";

export type DrawTool = "select" | DrawingKind;

export interface DrawingUiState {
  tool: DrawTool;
  selectedId: string | null;
  count: number;
  color: string;
  /** What to do next, in words (shown beside the toolbar and read out by screen readers). */
  hint: string;
}

interface Opts {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  container: HTMLElement;
  getTimes: () => readonly number[];
  fmtPrice: (v: number) => string;
  /** Called after every change to the list (create, move, delete, clear) with the new list. */
  onPersist: (drawings: Drawing[]) => void;
  onState: (s: DrawingUiState) => void;
}

const HINTS: Record<DrawTool, string> = {
  select: "Select a drawing to move it, drag its square handles to resize, press Delete to remove it.",
  hline: "Click the chart to place a horizontal line. Escape cancels.",
  trend: "Click the start point, then the end point. Escape cancels.",
  rect: "Click one corner, then the opposite corner. Escape cancels.",
};

export class DrawingController {
  private readonly prim = new DrawingsPrimitive();
  private drawings: Drawing[] = [];
  private selectedId: string | null = null;
  private tool: DrawTool = "select";
  private color = DEFAULT_DRAWING_COLOR;
  /** First point of a two-point shape being created. */
  private pending: AnchorPoint | null = null;
  private hover: AnchorPoint | null = null;
  private drag: { id: string; part: HitPart; start: AnchorPoint; original: Drawing; moved: boolean } | null = null;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly o: Opts) {
    o.series.attachPrimitive(this.prim);
    const c = o.container;
    const on = <K extends keyof HTMLElementEventMap>(t: K, h: (e: HTMLElementEventMap[K]) => void, capture = false, opts?: AddEventListenerOptions) => {
      c.addEventListener(t, h as EventListener, { capture, ...opts });
      this.cleanups.push(() => c.removeEventListener(t, h as EventListener, { capture } as EventListenerOptions));
    };
    const onDoc = <K extends keyof DocumentEventMap>(t: K, h: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      document.addEventListener(t, h as EventListener, opts);
      this.cleanups.push(() => document.removeEventListener(t, h as EventListener, opts as EventListenerOptions));
    };
    on("mousedown", (e) => this.down(e.clientX, e.clientY, e), true);
    on("touchstart", (e) => e.touches.length === 1 && this.down(e.touches[0].clientX, e.touches[0].clientY, e), true, { passive: false });
    on("mousemove", (e) => this.move(e.clientX, e.clientY, e), true);
    on("touchmove", (e) => e.touches.length === 1 && this.move(e.touches[0].clientX, e.touches[0].clientY, e), true, { passive: false });
    onDoc("mousemove", (e) => this.drag && this.move(e.clientX, e.clientY, e));
    onDoc("mouseup", () => this.up());
    onDoc("touchend", () => this.up());
    this.emit();
  }

  // ------------------------------------------------------------ public API

  getDrawings(): Drawing[] {
    return this.drawings;
  }

  getSelected(): Drawing | null {
    return this.drawings.find((d) => d.id === this.selectedId) ?? null;
  }

  /** Replaces the list (used when the symbol or timeframe changes). Does not call onPersist. */
  setDrawings(list: Drawing[]): void {
    this.drawings = list.slice(0, MAX_DRAWINGS);
    this.selectedId = null;
    this.pending = null;
    this.drag = null;
    this.refresh();
  }

  setTool(t: DrawTool): void {
    this.tool = t;
    this.pending = null;
    this.hover = null;
    if (t !== "select") this.selectedId = null;
    this.refresh();
  }

  setColor(hex: string): void {
    this.color = hex;
    if (this.selectedId) {
      this.drawings = this.drawings.map((d) => (d.id === this.selectedId ? { ...d, color: hex } : d));
      this.changed();
    }
    this.refresh();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
    this.selectedId = null;
    this.changed();
  }

  clearAll(): void {
    this.drawings = [];
    this.selectedId = null;
    this.pending = null;
    this.changed();
  }

  /** Keyboard path: a horizontal line at a price (the last price, or an alert level) without using the mouse. */
  addHLine(price: number): void {
    if (!Number.isFinite(price)) return;
    this.add({ id: newDrawingId(), kind: "hline", color: this.color, p1: { time: 0, price } });
  }

  selectNext(step: 1 | -1): void {
    if (this.drawings.length === 0) return;
    const i = this.drawings.findIndex((d) => d.id === this.selectedId);
    const next = i === -1 ? (step === 1 ? 0 : this.drawings.length - 1) : (i + step + this.drawings.length) % this.drawings.length;
    this.selectedId = this.drawings[next].id;
    this.tool = "select";
    this.refresh();
  }

  /** Arrow keys on the selected drawing: up/down by 0.25% of its price, left/right by one bar. */
  nudge(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    const d = this.drawings.find((x) => x.id === this.selectedId);
    if (!d) return;
    const times = this.o.getTimes();
    const spacing = times.length > 1 ? times[times.length - 1] - times[times.length - 2] || 86_400 : 86_400;
    const moved = translateDrawing(d, dx * spacing, dy * keyboardPriceStep(d.p1.price));
    this.drawings = this.drawings.map((x) => (x.id === d.id ? moved : x));
    this.changed();
  }

  cancel(): void {
    if (this.pending || this.tool !== "select") {
      this.pending = null;
      this.tool = "select";
    } else {
      this.selectedId = null;
    }
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.cleanups) f();
    this.cleanups.length = 0;
    try {
      this.o.series.detachPrimitive(this.prim);
    } catch {
      /* chart already removed */
    }
  }

  // ------------------------------------------------------------ pointer handling

  private local(clientX: number, clientY: number): { x: number; y: number; plotW: number; plotH: number } {
    const r = this.o.container.getBoundingClientRect();
    // The time scale spans exactly the plot area (the price axis is outside it).
    const plotW = this.o.chart.timeScale().width() || r.width;
    const plotH = this.o.chart.panes()[0]?.getHeight() ?? r.height;
    return { x: clientX - r.left, y: clientY - r.top, plotW, plotH };
  }

  private consume(e: Event): void {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }

  private down(cx: number, cy: number, e: Event): void {
    if (this.disposed) return;
    const { x, y, plotW, plotH } = this.local(cx, cy);
    if (x < 0 || y < 0 || x > plotW || y > plotH) return; // axes and indicator panes belong to the chart
    if (this.tool !== "select") {
      this.consume(e);
      this.place(x, y);
      return;
    }
    const h = this.prim.hit(x, y, plotW);
    if (!h) {
      if (this.selectedId) {
        this.selectedId = null;
        this.refresh();
      }
      return; // plain chart interaction (pan, crosshair)
    }
    this.consume(e);
    this.selectedId = h.id;
    const start = this.prim.anchorAt(x, y);
    const original = this.drawings.find((d) => d.id === h.id);
    if (start && original) this.drag = { id: h.id, part: h.part, start, original, moved: false };
    this.refresh();
  }

  private move(cx: number, cy: number, e: Event): void {
    if (this.disposed) return;
    const { x, y, plotW, plotH } = this.local(cx, cy);
    const at = this.prim.anchorAt(x, y);
    if (this.drag) {
      this.consume(e);
      if (!at) return;
      const d = this.drag;
      let next: Drawing;
      if (d.part === "body") next = translateDrawing(d.original, at.time - d.start.time, at.price - d.start.price);
      else next = moveEndpoint(d.original, d.part === "p1" ? 1 : 2, { time: at.time, price: at.price });
      d.moved = true;
      this.drawings = this.drawings.map((x2) => (x2.id === d.id ? next : x2));
      this.refresh();
      return;
    }
    if (this.pending && this.tool !== "select") {
      this.hover = x >= 0 && y >= 0 && x <= plotW && y <= plotH ? at : this.hover;
      this.refresh();
    }
    // Pointer cursor feedback over a drawing
    if (this.tool === "select") {
      const over = x >= 0 && y >= 0 && x <= plotW && y <= plotH && this.prim.hit(x, y, plotW);
      this.o.container.style.cursor = over ? "pointer" : "";
    } else {
      this.o.container.style.cursor = "crosshair";
    }
  }

  private up(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.changed();
  }

  private place(x: number, y: number): void {
    const at = this.prim.anchorAt(x, y);
    if (!at) return;
    const times = this.o.getTimes();
    const point = { time: snapToBar(times, at.time), price: at.price };
    if (this.tool === "hline") {
      this.add({ id: newDrawingId(), kind: "hline", color: this.color, p1: { time: point.time, price: point.price } });
      return;
    }
    if (!this.pending) {
      this.pending = point;
      this.hover = point;
      this.refresh();
      return;
    }
    const kind = this.tool as DrawingKind;
    if (this.pending.time === point.time && this.pending.price === point.price) return; // zero-size shape
    this.add({ id: newDrawingId(), kind, color: this.color, p1: this.pending, p2: point });
  }

  private add(d: Drawing): void {
    if (this.drawings.length >= MAX_DRAWINGS) this.drawings = this.drawings.slice(1);
    this.drawings = [...this.drawings, d];
    this.selectedId = d.id;
    this.pending = null;
    this.tool = "select";
    this.changed();
  }

  // ------------------------------------------------------------ state out

  private changed(): void {
    this.o.onPersist(this.drawings);
    this.refresh();
  }

  private previewShape(): Drawing | null {
    if (!this.pending || !this.hover || this.tool === "select" || this.tool === "hline") return null;
    return { id: "preview", kind: this.tool, color: this.color, p1: this.pending, p2: this.hover };
  }

  private refresh(): void {
    this.prim.setState(this.drawings, this.selectedId, this.previewShape(), this.o.getTimes(), this.o.fmtPrice);
    this.emit();
  }

  private emit(): void {
    const hint = this.pending ? (this.tool === "rect" ? "Click the opposite corner." : "Click the end point.") : HINTS[this.tool];
    this.o.onState({ tool: this.tool, selectedId: this.selectedId, count: this.drawings.length, color: this.color, hint });
  }

  /** Re-render after the data (bar times) changed. */
  redraw(): void {
    this.refresh();
  }
}
