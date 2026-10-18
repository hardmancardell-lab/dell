import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/access/tokens";
import { getTickerNews } from "@/lib/news/news-hub";
import { HEADLINE_LOG_SYMBOLS, dailyHeadlineStats, mergeDayCounts } from "@/lib/news-impact/headline-log";
import {
  NewsHeadlineDbUnavailable,
  getStoredDays,
  isNewsHeadlineDbConfigured,
  pruneOlderThan,
  upsertDay,
} from "@/lib/data/news-headline-db";

export const maxDuration = 60;

const RETENTION_DAYS = 800;

function dateKeyDaysAgo(ms: number, days: number): string {
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}

interface SymbolResult {
  symbol: string;
  ok: boolean;
  days: number;
  error: string | null;
}

/**
 * Daily headline-count logger. Called a few times a day by .github/workflows/news-headline-log-cron.yml (Vercel Hobby
 * allows only one daily cron, see ALERTS_INTEGRATION_NOTES.md). Same secret check as /api/cron/option-flow. For each
 * logged symbol it reads the headlines the News hub already reads, groups them by Eastern publication date, merges them
 * into the day's stored row (already-counted stories are not counted again) and stores counts, outlet names and short
 * hashes only: no headline text and no links. Logs counts, never a view on direction.
 */
export async function GET(request: Request) {
  if (!(await bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isNewsHeadlineDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Headline logging is not configured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  const results: SymbolResult[] = [];
  let dbMissing: string | null = null;
  // Two at a time: the Yahoo feed is public and polite use matters more than speed.
  let next = 0;
  const workers = Array.from({ length: 2 }, async () => {
    for (;;) {
      const i = next++;
      if (i >= HEADLINE_LOG_SYMBOLS.length || dbMissing) return;
      const { symbol, assetClass } = HEADLINE_LOG_SYMBOLS[i];
      try {
        const section = await getTickerNews(symbol, assetClass, false);
        if (section.error) {
          results.push({ symbol, ok: false, days: 0, error: "No headline source answered for this symbol." });
          continue;
        }
        const days = dailyHeadlineStats(section.items);
        const stored = await getStoredDays(symbol, days.map((d) => d.countDate));
        for (const day of days) {
          const prev = stored.find((s) => s.countDate === day.countDate) ?? null;
          const merged = mergeDayCounts(prev, day);
          await upsertDay(symbol, assetClass, merged, (prev?.captures ?? 0) + 1, prev?.firstCapturedAt ?? null);
        }
        results.push({ symbol, ok: true, days: days.length, error: null });
      } catch (e) {
        if (e instanceof NewsHeadlineDbUnavailable) dbMissing = e.message;
        results.push({ symbol, ok: false, days: 0, error: e instanceof NewsHeadlineDbUnavailable ? e.message : "This symbol could not be logged." });
      }
    }
  });
  await Promise.all(workers);

  if (dbMissing) return NextResponse.json({ ok: false, error: dbMissing }, { status: 503 });

  // Retention: once a day, on the first scheduled run after 02:00 UTC.
  let pruned: string | null = null;
  if (new Date().getUTCHours() === 2) {
    try {
      await pruneOlderThan(dateKeyDaysAgo(Date.now(), RETENTION_DAYS));
      pruned = "ok";
    } catch {
      pruned = "failed";
    }
  }

  const anyOk = results.some((r) => r.ok);
  return NextResponse.json(
    { ok: anyOk, okCount: results.filter((r) => r.ok).length, failedCount: results.filter((r) => !r.ok).length, pruned, results },
    // Non-2xx when nothing was stored, so the GitHub Actions run goes red instead of silently logging nothing.
    { status: anyOk ? 200 : 502 }
  );
}
