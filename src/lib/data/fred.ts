const FRED_BASE_URL = "https://api.stlouisfed.org/fred";

export interface FredObservation {
  date: string;
  value: number | null;
}

interface RawFredObservation {
  date: string;
  value: string;
}

interface FredObservationsResponse {
  observations: RawFredObservation[];
}

function getApiKey(): string {
  const key = process.env.FRED_API_KEY;
  if (!key || key === "paste_your_fred_key_here") {
    throw new Error(
      "FRED_API_KEY is not set. Add your key to .env.local (see fred.stlouisfed.org/docs/api/api_key.html)."
    );
  }
  return key;
}

/**
 * Fetches observations for a single FRED series, most recent last.
 * `limit` counts back from the most recent observation.
 */
export async function fetchFredSeries(
  seriesId: string,
  limit = 24
): Promise<FredObservation[]> {
  const apiKey = getApiKey();
  const url = new URL(`${FRED_BASE_URL}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    // FRED series update at most daily; avoid re-fetching every request.
    next: { revalidate: 60 * 60 * 12 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `FRED request failed for series ${seriesId}: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as FredObservationsResponse;

  return data.observations
    .map((obs) => ({
      date: obs.date,
      value: obs.value === "." ? null : Number(obs.value),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface FredNonNullObservation {
  date: string;
  value: number;
}

/** Most recent non-null observation in a series. */
export function latest(observations: FredObservation[]): FredNonNullObservation | null {
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    const obs = observations[i];
    if (obs.value !== null) return { date: obs.date, value: obs.value };
  }
  return null;
}

/** Year-over-year percent change from the latest observation, for series with a known frequency. */
export function yoyPercentChange(
  observations: FredObservation[],
  periodsPerYear: number
): number | null {
  const clean = observations.filter((o) => o.value !== null);
  if (clean.length <= periodsPerYear) return null;
  const current = clean[clean.length - 1].value as number;
  const prior = clean[clean.length - 1 - periodsPerYear].value as number;
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
