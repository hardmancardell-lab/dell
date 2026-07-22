/**
 * All checkpoint windows are defined in Eastern Time and converted via
 * Intl.DateTimeFormat (DST-aware) rather than a fixed UTC offset — a fixed
 * offset would silently misclassify bars for roughly half the year.
 */

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface EasternTimeParts {
  dateKey: string; // YYYY-MM-DD in ET
  minutesSinceMidnight: number;
}

export function toEasternParts(epochMs: number): EasternTimeParts {
  const parts = ET_FORMATTER.formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  // formatToParts with hour12:false renders midnight as "24", not "00"
  const hourRaw = Number(get("hour"));
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number(get("minute"));

  return {
    dateKey: `${year}-${month}-${day}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function minutes(h: number, m: number): number {
  return h * 60 + m;
}

export const WINDOWS = {
  PREMARKET: { start: minutes(4, 0), end: minutes(9, 30) },
  FIRST_15_MIN: { start: minutes(9, 30), end: minutes(9, 45) },
  FIRST_HOUR: { start: minutes(9, 30), end: minutes(10, 30) },
  CT_10AM_ROLLOFF: { start: minutes(10, 55), end: minutes(11, 5) }, // 10:00am CT = 11:00am ET
  MIDDAY_CHOP: { start: minutes(11, 30), end: minutes(13, 30) },
  POWER_HOUR: { start: minutes(15, 0), end: minutes(16, 0) },
  LAST_15_MIN: { start: minutes(15, 45), end: minutes(16, 0) },
  REGULAR_SESSION: { start: minutes(9, 30), end: minutes(16, 0) },
  NEXT_DAY_FOLLOW_THROUGH: { start: minutes(9, 30), end: minutes(10, 0) },
} as const;

/** The opening-range window an ORB strategy is defined against — the first N minutes after the open. */
export function openingRangeWindow(rangeMinutes: 5 | 15 | 30): { start: number; end: number } {
  return { start: minutes(9, 30), end: minutes(9, 30) + rangeMinutes };
}

export function isWithin(minutesSinceMidnight: number, window: { start: number; end: number }): boolean {
  return minutesSinceMidnight >= window.start && minutesSinceMidnight < window.end;
}

/** Formats a minutesSinceMidnight value back to "H:MMam/pm" for display. */
export function formatMinutesAsClock(minutesSinceMidnight: number): string {
  const h24 = Math.floor(minutesSinceMidnight / 60) % 24;
  const m = minutesSinceMidnight % 60;
  const period = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${period}`;
}

/** Buckets a minutesSinceMidnight value into a 30-minute label within the regular session. */
export function thirtyMinuteBucketLabel(minutesSinceMidnight: number): string {
  const bucketStart = Math.floor(minutesSinceMidnight / 30) * 30;
  return `${formatMinutesAsClock(bucketStart)}-${formatMinutesAsClock(bucketStart + 30)}`;
}

/** The numeric start-of-bucket minute for thirtyMinuteBucketLabel — lets callers sort buckets chronologically instead of by label string or frequency count. */
export function thirtyMinuteBucketStart(minutesSinceMidnight: number): number {
  return Math.floor(minutesSinceMidnight / 30) * 30;
}

/**
 * Shared by historical-composite.ts and calendar-effects.ts — a HOD/LOD
 * distribution reads as a timeline, so buckets are sorted chronologically
 * by start time, not by frequency count. `total` is the full occurrence/day
 * count the caller is measuring against (may exceed the sum of bucket
 * counts if some days lacked a usable high/low timestamp), so pctOfTotal
 * honestly reflects "% of all days", not just "% of days with a timestamp".
 */
export function buildTimeOfDayFrequency(
  minutes: number[],
  total: number
): { bucketLabel: string; count: number; pctOfTotal: number }[] {
  const counts = new Map<number, { label: string; count: number }>();
  for (const m of minutes) {
    const start = thirtyMinuteBucketStart(m);
    const existing = counts.get(start);
    if (existing) existing.count += 1;
    else counts.set(start, { label: thirtyMinuteBucketLabel(m), count: 1 });
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ bucketLabel: v.label, count: v.count, pctOfTotal: total > 0 ? (v.count / total) * 100 : 0 }));
}
