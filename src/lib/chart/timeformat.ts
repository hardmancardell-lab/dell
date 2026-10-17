// Pure: time labels for the chart axis, crosshair and legend in a stated zone. lightweight-charts treats the timestamps
// as UTC, so without a formatter an equity chart shows UTC clock times with no label. US equity bars are shown in
// Eastern time (the exchange clock); everything else in UTC. The zone is also printed in the chart header.

export type ChartZone = "America/New_York" | "UTC";

export const ZONE_LABEL: Record<ChartZone, string> = { "America/New_York": "ET", UTC: "UTC" };

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: ChartZone, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${zone}|${key}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", ...opts });
    cache.set(k, f);
  }
  return f;
}

/** "14:05" in the zone for epoch seconds. */
export function formatClock(sec: number, zone: ChartZone): string {
  return fmt(zone, "clock", { hour: "2-digit", minute: "2-digit" }).format(new Date(sec * 1000));
}

/** "2026-10-14" in the zone. */
export function formatDay(sec: number, zone: ChartZone): string {
  const parts = fmt(zone, "day", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Crosshair / legend label: day only for daily+ bars, "day HH:MM ZONE" for intraday. */
export function formatBarLabel(sec: number, zone: ChartZone, intraday: boolean): string {
  return intraday ? `${formatDay(sec, zone)} ${formatClock(sec, zone)} ${ZONE_LABEL[zone]}` : formatDay(sec, zone);
}

/** Axis tick label matching lightweight-charts' TickMarkType (0 year, 1 month, 2 day of month, 3 time, 4 time with seconds). */
export function formatTick(sec: number, tickType: number, zone: ChartZone): string {
  const d = new Date(sec * 1000);
  switch (tickType) {
    case 0:
      return fmt(zone, "y", { year: "numeric" }).format(d);
    case 1:
      return fmt(zone, "m", { month: "short" }).format(d);
    case 2:
      return fmt(zone, "d", { day: "numeric" }).format(d);
    case 4:
      return fmt(zone, "ts", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
    default:
      return formatClock(sec, zone);
  }
}

/** The zone a chart should display for a data provider: US equities (Alpaca) in Eastern, the rest in UTC. */
export function zoneForProvider(provider: string | null | undefined): ChartZone {
  return provider === "Alpaca" ? "America/New_York" : "UTC";
}
