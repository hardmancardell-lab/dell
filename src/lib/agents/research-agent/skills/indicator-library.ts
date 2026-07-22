import { fetchFredSeries } from "@/lib/data/fred";
import { INDICATOR_LIBRARY, type IndicatorMeta } from "./indicator-metadata";

export interface IndicatorSeriesPoint {
  date: string;
  value: number;
}

export interface IndicatorSeriesResult {
  meta: IndicatorMeta;
  points: IndicatorSeriesPoint[];
}

function toYoyPercent(
  points: IndicatorSeriesPoint[],
  periodsPerYear: number
): IndicatorSeriesPoint[] {
  const result: IndicatorSeriesPoint[] = [];
  for (let i = periodsPerYear; i < points.length; i++) {
    const prior = points[i - periodsPerYear].value;
    if (prior === 0) continue;
    result.push({
      date: points[i].date,
      value: ((points[i].value - prior) / Math.abs(prior)) * 100,
    });
  }
  return result;
}

export async function getIndicatorSeries(id: string, limit = 60): Promise<IndicatorSeriesResult> {
  const meta = INDICATOR_LIBRARY.find((i) => i.id === id);
  if (!meta) {
    throw new Error(`Unknown indicator id "${id}".`);
  }

  const needsExtraHistory = meta.yoyTransform && meta.periodsPerYear ? meta.periodsPerYear : 0;
  const observations = await fetchFredSeries(meta.seriesId, limit + needsExtraHistory);
  const rawPoints = observations
    .filter((o) => o.value !== null)
    .map((o) => ({ date: o.date, value: o.value as number }));

  const points =
    meta.yoyTransform && meta.periodsPerYear
      ? toYoyPercent(rawPoints, meta.periodsPerYear).slice(-limit)
      : rawPoints.slice(-limit);

  return { meta, points };
}
