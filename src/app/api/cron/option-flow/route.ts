import { NextResponse } from "next/server";
import * as tradier from "@/lib/data/tradier";
import { resolveOptionFlowFeed } from "@/lib/data/tradier";
import { fetchQuote } from "@/lib/data/market-data";
import {
  OptionFlowDbUnavailable,
  getLastSnapshotBeforeSession,
  getPreviousSnapshot,
  isOptionFlowDbConfigured,
  prune,
  upsertSnapshot,
} from "@/lib/data/option-flow-db";
import { OPTION_FLOW_CONFIG, OPTION_FLOW_SYMBOLS, isRegularSession, sessionDateET } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";
import { runOptionFlowTick } from "@/lib/agents/trading-agent/skills/option-flow-service";
import type { OptionFlowDeps } from "@/lib/agents/trading-agent/skills/option-flow-service";
import { toEasternParts } from "@/lib/agents/trading-agent/skills/time-windows";

export const maxDuration = 60;

/** ET date key `days` calendar days before `ms`. Uses a UTC round trip on the ET date, so DST never shifts it. */
function dateKeyDaysAgo(ms: number, days: number): string {
  const [y, m, d] = sessionDateET(ms).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Intraday option-flow logger. Called every 5 minutes by .github/workflows/option-flow-cron.yml (Vercel Hobby allows
 * only one daily cron, see ALERTS_INTEGRATION_NOTES.md). Same secret check as /api/cron/check-alerts. The workflow
 * fires on a UTC superset (13:30-21:00); this route trims to the exact ET session. Logs raw measures only.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  if (!isRegularSession(nowMs)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Outside the regular session (9:30am-4:00pm ET, weekdays)." });
  }

  // Which Tradier feed this run uses. Production only when OPTION_FLOW_TRADIER_MODE=production AND TRADIER_PRODUCTION_TOKEN
  // is set. A request for production without the token (or a mode value that is not recognised) stops here, before any
  // provider or database call: never a silent fallback to sandbox, which would mix delayed and real-time rows in the log.
  const choice = resolveOptionFlowFeed();
  if (!choice.ok) {
    return NextResponse.json({ ok: false, error: `Option-flow logging is not configured: ${choice.error}` }, { status: 503 });
  }
  const feed = choice.feed;

  const missing: string[] = [];
  if (!isOptionFlowDbConfigured()) missing.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  if (feed === "sandbox" && !process.env.TRADIER_ACCESS_TOKEN) missing.push("TRADIER_ACCESS_TOKEN (Tradier is the only provider with real option volume and open interest)");
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, error: `Option-flow logging is not configured: missing ${missing.join("; ")}.` }, { status: 503 });
  }

  const deps: OptionFlowDeps = {
    // Expirations and chains bypass Next's 5-minute data cache: a cached chain would make consecutive snapshots identical.
    getExpirations: (symbol, f) => tradier.getExpirations(symbol, { fresh: true, feed: f }),
    fetchChain: (symbol, expiration, f) => tradier.fetchOptionsChain(symbol, expiration, { fresh: true, feed: f }),
    fetchQuote,
    getPrevious: getPreviousSnapshot,
    getPriorSessionFinal: getLastSnapshotBeforeSession,
    upsert: upsertSnapshot,
  };

  try {
    const tick = await runOptionFlowTick({ nowMs, symbols: OPTION_FLOW_SYMBOLS, deps, feed, concurrency: 2, maxOiPassesPerRun: 2 });

    // Retention, once per session on the opening bucket: drop per-contract detail first, whole rows much later.
    let pruned: string | null = null;
    const { minutesSinceMidnight } = toEasternParts(nowMs);
    if (minutesSinceMidnight < 9 * 60 + 35) {
      try {
        await prune(dateKeyDaysAgo(nowMs, OPTION_FLOW_CONFIG.detailRetentionDays), { detailOnly: true });
        await prune(dateKeyDaysAgo(nowMs, OPTION_FLOW_CONFIG.rowRetentionDays));
        pruned = "ok";
      } catch (err) {
        pruned = err instanceof Error ? err.message : "unknown error";
      }
    }

    const anyOk = tick.results.some((r) => r.ok);
    // Non-2xx when nothing was stored, so the GitHub Actions run (curl -f) goes red instead of silently logging nothing.
    return NextResponse.json({
      ok: anyOk,
      snapshotTime: tick.snapshotTime,
      sessionDate: sessionDateET(nowMs),
      dataFeed: feed,
      okCount: tick.results.filter((r) => r.ok).length,
      failedCount: tick.results.filter((r) => !r.ok).length,
      tradierCalls: tick.results.reduce((s, r) => s + r.tradierCalls, 0),
      pruned,
      results: tick.results,
    }, { status: anyOk ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: err instanceof OptionFlowDbUnavailable ? 503 : 500 });
  }
}
