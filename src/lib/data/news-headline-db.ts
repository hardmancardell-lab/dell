import type { DayCounts, SeenMap } from "@/lib/news-impact/headline-log";

/**
 * Plain-fetch Supabase REST access for news_headline_counts, same header pattern as option-flow-db.ts (service-role key,
 * no client library). A missing table or missing config surfaces as NewsHeadlineDbUnavailable, which names the migration.
 */

const TABLE = "news_headline_counts";
const MIGRATION = "db/migrations/2026-10-18_news_headline_counts.sql";

export class NewsHeadlineDbUnavailable extends Error {}

export function isNewsHeadlineDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function request<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new NewsHeadlineDbUnavailable("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so headline counts cannot be stored.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: init.prefer ?? "return=minimal" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(text)) {
      throw new NewsHeadlineDbUnavailable(`The news_headline_counts table does not exist yet. Run ${MIGRATION} in the Supabase SQL editor.`);
    }
    throw new Error(`Supabase request failed (${res.status}) for ${path.split("?")[0]}.`);
  }
  return init.prefer?.includes("return=representation") ? ((await res.json()) as T) : (undefined as T);
}

export interface StoredDay {
  countDate: string;
  seen: SeenMap;
  feedCapped: boolean;
  captures: number;
  firstCapturedAt: string | null;
}

/** The stored rows for a symbol on the given dates (the capture merges into these). */
export async function getStoredDays(symbol: string, dates: string[]): Promise<StoredDay[]> {
  if (dates.length === 0) return [];
  const list = dates.map((d) => `"${d}"`).join(",");
  const rows = await request<Record<string, unknown>[]>(
    `${TABLE}?select=count_date,seen,feed_capped,captures,first_captured_at&symbol=eq.${encodeURIComponent(symbol)}&count_date=in.(${encodeURIComponent(list)})`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map((r) => ({
    countDate: String(r.count_date).slice(0, 10),
    seen: (r.seen as SeenMap) ?? {},
    feedCapped: Boolean(r.feed_capped),
    captures: Number(r.captures ?? 1),
    firstCapturedAt: r.first_captured_at ? new Date(String(r.first_captured_at)).toISOString() : null,
  }));
}

/** Idempotent per (symbol, date): the merged day replaces the stored one. */
export async function upsertDay(symbol: string, assetClass: string, day: DayCounts, captures: number, firstCapturedAt: string | null): Promise<void> {
  const now = new Date().toISOString();
  await request(`${TABLE}?on_conflict=symbol,count_date`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      symbol,
      asset_class: assetClass,
      count_date: day.countDate,
      headline_count: day.headlineCount,
      filing_count: day.filingCount,
      opinion_count: day.opinionCount,
      source_counts: day.sourceCounts,
      seen: day.seen,
      feed_capped: day.feedCapped,
      first_captured_at: firstCapturedAt ?? now,
      last_captured_at: now,
      captures,
      updated_at: now,
    },
  });
}

/** Retention: whole rows older than the cutoff (a Eastern date, YYYY-MM-DD). Counts are tiny, so this is generous. */
export async function pruneOlderThan(dateKey: string): Promise<void> {
  await request(`${TABLE}?count_date=lt.${dateKey}`, { method: "DELETE" });
}
