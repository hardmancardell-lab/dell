import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/access/tokens";
import { OptionFlowDbUnavailable, getDatesWithDetail, getDayRowsRaw, isOptionFlowDbConfigured } from "@/lib/data/option-flow-db";
import { OPTION_FLOW_SYMBOLS } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";

export const maxDuration = 60;

/** Vercel caps a function's response body at 4.5 MB; stay under it and tell the caller to page instead of failing. */
const MAX_BODY_BYTES = 4_200_000;

/**
 * Read-only export of the stored option-flow rows, per-contract detail included, so the detail can be saved to files before the
 * prune job nulls it (OPTION_FLOW_CONFIG.detailRetentionDays). Same Bearer CRON_SECRET check as /api/cron/option-flow; nothing is written.
 *
 *   GET /api/cron/option-flow-export?list=1                        -> { symbols, dates: { SPY: ["2026-10-23", ...], ... } } (days that still have detail)
 *   GET /api/cron/option-flow-export?symbol=SPY&date=2026-11-05    -> { symbol, date, offset, count, rows: [every column as stored] }
 *   add &offset=N&limit=M to page when a day is over the size cap (a 413 says so).
 */
export async function GET(request: Request) {
  if (!(await bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isOptionFlowDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Option-flow export is not configured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get("list") === "1") {
      const dates: Record<string, string[]> = {};
      for (const s of OPTION_FLOW_SYMBOLS) dates[s] = await getDatesWithDetail(s);
      return NextResponse.json({ ok: true, symbols: OPTION_FLOW_SYMBOLS, dates });
    }
    const symbol = (searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!OPTION_FLOW_SYMBOLS.includes(symbol)) {
      return NextResponse.json({ ok: false, error: `symbol must be one of ${OPTION_FLOW_SYMBOLS.join(", ")}.` }, { status: 400 });
    }
    const date = searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD." }, { status: 400 });
    }
    const offset = Number(searchParams.get("offset") ?? 0), limit = Number(searchParams.get("limit") ?? 500);
    if (!Number.isFinite(offset) || !Number.isFinite(limit)) {
      return NextResponse.json({ ok: false, error: "offset and limit must be numbers." }, { status: 400 });
    }
    const rows = await getDayRowsRaw(symbol, date, { offset, limit });
    const body = JSON.stringify({ ok: true, symbol, date, offset: Math.max(0, Math.floor(offset)), count: rows.length, rows });
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "Too large for one response; repeat with &offset=0&limit=40, then offset=40, and so on.", count: rows.length }, { status: 413 });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: err instanceof OptionFlowDbUnavailable ? 503 : 500 });
  }
}
