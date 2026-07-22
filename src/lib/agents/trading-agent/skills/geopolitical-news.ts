import type {
  FxCoverageSpikeSignal,
  GeopoliticalArticle,
  GeopoliticalNewsResult,
  GeopoliticalVolumePoint,
} from "../types";

const COVERAGE_SPIKE_MULTIPLE = 3;

const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

/**
 * GDELT's DOC 2.0 API is keyless/free, no signup — confirmed working live
 * against the real running app. It does enforce a real rate limit though
 * (~1 request per 5 seconds), confirmed the same way: a query fired right
 * after a successful one failed with a connection-level error, and
 * succeeded again once spaced out. getGeopoliticalNews below deliberately
 * serializes its two GDELT calls with a gap rather than firing them in
 * parallel, for this reason.
 */
async function fetchGdelt<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(GDELT_BASE_URL);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), { next: { revalidate: 60 * 15 } }); // 15 min cache

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GDELT request failed: ${res.status} ${body}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // GDELT returns a plain-text rate-limit/error banner (not JSON) when
    // it's unhappy — surface that text directly rather than a cryptic
    // "Unexpected token" JSON parse error.
    throw new Error(`GDELT did not return JSON: ${text.slice(0, 200)}`);
  }
}

type GdeltFetchResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function safeFetchGdelt<T>(params: Record<string, string>): Promise<GdeltFetchResult<T>> {
  try {
    const value = await fetchGdelt<T>(params);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

interface GdeltArtListResponse {
  articles?: {
    url: string;
    title: string;
    domain: string;
    seendate: string;
    sourcecountry?: string;
  }[];
}

interface GdeltTimelineResponse {
  timeline?: {
    data: { date: string; value: number }[];
  }[];
}

/**
 * Major currency pairs mapped to the geopolitical/macro keywords that
 * actually move them, and why — a currency pair isn't just "the exchange
 * rate," it's a proxy for the relative economic and political conditions of
 * the two economies behind it.
 */
export const MAJOR_PAIR_KEYWORDS: { pair: string; query: string; mechanismNote: string }[] = [
  {
    pair: "EUR/USD",
    query: `"European Central Bank" OR Eurozone OR ECB OR "Germany economy"`,
    mechanismNote:
      "The world's most-traded pair — moves on ECB vs. Fed policy divergence, Eurozone growth/inflation data, and German economic health specifically (Germany is the bloc's largest economy).",
  },
  {
    pair: "USD/JPY",
    query: `"Bank of Japan" OR BOJ OR yen OR "Japan intervention"`,
    mechanismNote:
      "Highly sensitive to BOJ policy (Japan held near-zero rates far longer than other major central banks) and to Japanese government FX intervention, which has moved this pair sharply and abruptly in the past.",
  },
  {
    pair: "GBP/USD",
    query: `"Bank of England" OR "UK economy" OR "British pound" OR Brexit`,
    mechanismNote:
      "Tracks Bank of England policy and UK-specific political/economic events — historically one of the more politically-news-sensitive major pairs (Brexit-era moves being the clearest example).",
  },
  {
    pair: "USD/CHF",
    query: `"Swiss National Bank" OR SNB OR "Swiss franc" OR "safe haven"`,
    mechanismNote:
      "The franc is a classic safe-haven currency — this pair often moves on global risk sentiment and geopolitical crises broadly, not just Swiss-specific news.",
  },
  {
    pair: "AUD/USD",
    query: `"Reserve Bank of Australia" OR RBA OR "China trade" OR "iron ore"`,
    mechanismNote:
      "AUD is effectively a China-proxy currency (Australia's economy is heavily commodity-export-linked to Chinese demand) — Chinese trade/growth news moves this pair as much as RBA policy does.",
  },
  {
    pair: "USD/CAD",
    query: `"Bank of Canada" OR "oil prices" OR "Canada economy"`,
    mechanismNote:
      "CAD is an oil-proxy currency (Canada is a major oil exporter) — crude oil price moves and Bank of Canada policy are the two dominant drivers.",
  },
];

export async function getGeopoliticalNews(
  query: string,
  pairLabel: string | null = null,
  mechanismNote: string | null = null
): Promise<GeopoliticalNewsResult> {
  const dataLimitations: string[] = [
    "GDELT is a global news-coverage index, not a curated 'this caused that' feed — a coverage-volume spike means a topic is suddenly getting more news attention, which correlates with market-moving events but isn't a guaranteed causal signal.",
    "GDELT rate-limits to roughly one request per 5 seconds. Each lookup here takes ~6 seconds because of that; searching again immediately after one just finished may hit the limit — wait a few seconds and retry if so.",
  ];

  // GDELT enforces a real rate limit (~1 request per 5 seconds) — confirmed
  // live during this build (a second distinct query fired seconds after a
  // successful one failed with a connection-level error, and succeeded again
  // once spaced out). Firing these two requests in parallel tripped it every
  // time, so they're deliberately sequential with a gap, not Promise.all.
  const artListResult = await safeFetchGdelt<GdeltArtListResponse>({
    query,
    mode: "ArtList",
    maxrecords: "10",
    sort: "DateDesc",
    timespan: "3d",
  });
  await new Promise((resolve) => setTimeout(resolve, 5500));
  const timelineResult = await safeFetchGdelt<GdeltTimelineResponse>({
    query,
    mode: "TimelineVol",
    timespan: "7d",
  });

  let articles: GeopoliticalArticle[] = [];
  if (artListResult.ok) {
    articles = (artListResult.value.articles ?? []).map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      date: a.seendate,
      sourceCountry: a.sourcecountry ?? null,
    }));
  } else {
    dataLimitations.push(`Article list unavailable: ${artListResult.error}`);
  }

  let coverageVolume: GeopoliticalVolumePoint[] = [];
  if (timelineResult.ok) {
    const series = timelineResult.value.timeline?.[0]?.data ?? [];
    coverageVolume = series.map((p) => ({ date: p.date, value: p.value }));
  } else {
    dataLimitations.push(`Coverage volume timeline unavailable: ${timelineResult.error}`);
  }

  if (articles.length === 0 && coverageVolume.length === 0) {
    throw new Error(
      `No data returned from GDELT for query "${query}". ${dataLimitations.join(" ")}`
    );
  }

  return { query, pairLabel, mechanismNote, articles, coverageVolume, dataLimitations };
}

/**
 * Checks each seeded major pair's coverage-volume trend for a spike relative
 * to its own recent average — a sudden jump in news coverage is itself a
 * signal something is actively moving that pair, before reading any articles.
 * Only fetches TimelineVol (not ArtList) per pair to keep this as light as
 * possible, but still has to serialize with the same GDELT rate-limit gap
 * used elsewhere in this file — 6 pairs takes roughly 30 seconds, so this is
 * meant to be triggered explicitly by the user, not run automatically.
 */
export interface CoverageSpikeResult {
  latestValue: number | null;
  averageValue: number | null;
  multiple: number | null;
  triggered: boolean;
}

/**
 * Pure spike math, extracted so both checkCoverageSpikes() below and the
 * alerts system's macro_news_spike condition share one implementation
 * rather than two copies of the same arithmetic.
 */
export function computeCoverageSpike(
  series: GeopoliticalVolumePoint[],
  spikeMultiple: number = COVERAGE_SPIKE_MULTIPLE
): CoverageSpikeResult {
  if (series.length < 2) {
    return { latestValue: null, averageValue: null, multiple: null, triggered: false };
  }
  const latestValue = series[series.length - 1].value;
  const priorValues = series.slice(0, -1).map((pt) => pt.value);
  const averageValue = priorValues.reduce((a, b) => a + b, 0) / priorValues.length;
  const multiple = averageValue > 0 ? latestValue / averageValue : null;
  return { latestValue, averageValue, multiple, triggered: multiple !== null && multiple >= spikeMultiple };
}

export async function checkCoverageSpikes(): Promise<FxCoverageSpikeSignal[]> {
  const results: FxCoverageSpikeSignal[] = [];

  for (let i = 0; i < MAJOR_PAIR_KEYWORDS.length; i += 1) {
    const p = MAJOR_PAIR_KEYWORDS[i];
    const timelineResult = await safeFetchGdelt<GdeltTimelineResponse>({
      query: p.query,
      mode: "TimelineVol",
      timespan: "7d",
    });

    if (!timelineResult.ok) {
      results.push({
        pair: p.pair,
        latestValue: null,
        averageValue: null,
        multiple: null,
        triggered: false,
        error: timelineResult.error,
      });
    } else {
      const series = timelineResult.value.timeline?.[0]?.data ?? [];
      if (series.length < 2) {
        results.push({
          pair: p.pair,
          latestValue: null,
          averageValue: null,
          multiple: null,
          triggered: false,
          error: "Not enough coverage-volume history returned.",
        });
      } else {
        const seriesPoints: GeopoliticalVolumePoint[] = series.map((pt) => ({ date: pt.date, value: pt.value }));
        const spike = computeCoverageSpike(seriesPoints);
        results.push({ pair: p.pair, ...spike, error: null });
      }
    }

    if (i < MAJOR_PAIR_KEYWORDS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5500));
    }
  }

  return results;
}
