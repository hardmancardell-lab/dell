// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/vwap-signal-log.test.mts
// Tests the forward-test log: live scan, write planning, summary, and the Supabase layer against a fake fetch.
import { readFileSync } from "node:fs";
import * as S from "../src/lib/agents/trading-agent/skills/vwap-band-study.ts";
import * as E from "../src/lib/agents/trading-agent/skills/vwap-band-engine.ts";
import * as L from "../src/lib/agents/trading-agent/skills/vwap-signal-log.ts";
import * as DB from "../src/lib/data/vwap-signal-db.ts";
import * as SVC from "../src/lib/agents/trading-agent/skills/vwap-signal-service.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const load = (f: string) => JSON.parse(readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8")).bars.map(([datetime, open, high, low, close, volume]) => ({ datetime, open, high, low, close, volume }));

const spy = load("spy_5m_regular_session.json");
const sessions = S.buildSessions(spy, "equity").sessions;
const full = E.findBandTrades(sessions, true, {}).trades;
const pick = full.find((x) => x.barsHeld >= 3 && (x.exitReason === "target" || x.exitReason === "stop"));
const si = sessions.findIndex((s) => s.dateKey === pick.dateKey);
const entryIdx = sessions[si].bars.findIndex((b) => b.datetime === pick.entryTimeMs);
const flat = (n: number) => sessions.slice(0, si).flatMap((s) => s.bars).concat(sessions[si].bars.slice(0, n));

// ---------------------------------------------------------------- scanning a running session
{
  const candles = flat(entryIdx + 1);
  const lastBar = candles[candles.length - 1];
  const nowLive = lastBar.datetime + 5 * 60000 + 2 * 60000; // two minutes after the entry bar closed
  const scan = L.scanSignals(candles, "SPY", "equity", nowLive);
  const rec = scan.records.find((r) => r.entryTimeMs === pick.entryTimeMs);
  t("scan: a short newest session with a fresh last bar is running", scan.sessionRunning === true && scan.newestSessionDate === pick.dateKey, JSON.stringify([scan.sessionRunning, scan.newestSessionDate]));
  t("scan: the touch on the newest bar is logged open, live, with a 2 minute lag", !!rec && rec.status === "open" && rec.source === "live" && rec.detectedLagMin === 2 && rec.exitReason === "open", JSON.stringify(rec));
  t("scan: the record carries the backtest's entry, side and volume Z", rec && rec.side === pick.side && near(rec.entryPrice, pick.entryPrice) && near(rec.volumeZ, pick.volumeZ));

  const stale = L.scanSignals(candles, "SPY", "equity", lastBar.datetime + 90 * 60000);
  t("scan: a stale feed is a skipped short day, not a running session", stale.sessionRunning === false && stale.notes.some((n) => /short session/.test(n)), JSON.stringify(stale.notes));
  t("scan: a stale feed does not make up new rows for the short day", stale.records.every((r) => r.sessionDate !== pick.dateKey));

  const late = L.scanSignals(flat(entryIdx + 2), "SPY", "equity", nowLive + 30 * 60000);
  t("scan: a scan that runs long after the bar is not a running session", late.sessionRunning === false);
}

// a touch seen late (scan ran once the session was running but well after the entry bar) is marked backfill
{
  const candles = flat(entryIdx + 8);
  const lastBar = candles[candles.length - 1];
  const scan = L.scanSignals(candles, "SPY", "equity", lastBar.datetime + 5 * 60000 + 60000);
  const rec = scan.records.find((r) => r.entryTimeMs === pick.entryTimeMs);
  t("scan: a touch found several bars later is backfill, with the lag recorded", !!rec && rec.source === "backfill" && rec.detectedLagMin > L.LIVE_LAG_MINUTES, JSON.stringify(rec));
  t("scan: by then the trade has its exit", rec && rec.status === "closed" && rec.exitReason === pick.exitReason && near(rec.exitPrice, pick.exitPrice), JSON.stringify(rec));
}

// ---------------------------------------------------------------- a finished newest session
{
  const candles = flat(sessions[si].bars.length);
  const end = candles[candles.length - 1].datetime + 60 * 60000;
  const scan = L.scanSignals(candles, "SPY", "equity", end);
  t("scan: after the close nothing is running and every row is closed", scan.sessionRunning === false && scan.records.length > 0 && scan.records.every((r) => r.status === "closed"));
  t("scan: the newest session date is the finished one", scan.newestSessionDate === pick.dateKey);
  t("scan: rows from earlier sessions are included only for resolving outcomes (at most 6 sessions)", new Set(scan.records.map((r) => r.sessionDate)).size <= 6);
  t("scan: rows seen long after the fact are backfill", scan.records.every((r) => r.source === "backfill"));

  const plan = L.planSignalWrites(scan.records, [], scan.newestSessionDate);
  t("plan: with an empty log only the newest session is inserted", plan.inserts.every((r) => r.sessionDate === scan.newestSessionDate) && plan.skippedOld === scan.records.filter((r) => r.sessionDate !== scan.newestSessionDate).length);
}

// ---------------------------------------------------------------- write planning on stored rows
{
  const base = (over = {}) => ({ symbol: "SPY", assetKind: "equity", sessionDate: "2026-10-01", entryTimeMs: 1000, side: "upper", k: 2, stopK: 3, entryPrice: 100, vwap: 99, sigma: 0.5, bandPct: 1, volumeZ: 0.2, volumeClass: "normal", status: "open", exitReason: "open", exitPrice: 100.2, barsHeld: 1, fadeReturnPct: -0.2, detectedLagMin: 1, source: "live", ...over });
  const stored = [{ id: "a", ...base() }, { id: "b", ...base({ entryTimeMs: 2000, status: "closed", exitReason: "target", exitPrice: 99, barsHeld: 4, fadeReturnPct: 1 }) }];
  const found = [
    base({ status: "closed", exitReason: "target", exitPrice: 99, barsHeld: 3, fadeReturnPct: 1 }), // a: open -> closed
    base({ entryTimeMs: 2000, status: "closed", exitReason: "stop", exitPrice: 105, barsHeld: 9, fadeReturnPct: -5 }), // b: closed, must not be rewritten
    base({ entryTimeMs: 3000 }), // new, newest session
    base({ entryTimeMs: 4000, sessionDate: "2026-09-30" }), // new, old session
  ];
  const plan = L.planSignalWrites(found, stored, "2026-10-01");
  t("plan: an open row that has closed is updated", plan.updates.length === 1 && plan.updates[0].id === "a" && plan.updates[0].patch.status === "closed" && plan.updates[0].patch.exitReason === "target");
  t("plan: a closed row is never rewritten", !plan.updates.some((u) => u.id === "b") && plan.unchanged === 1);
  t("plan: a new touch in the newest session is inserted, one in an old session is not", plan.inserts.length === 1 && plan.inserts[0].entryTimeMs === 3000 && plan.skippedOld === 1);
  const again = L.planSignalWrites(found.slice(0, 1).map((f) => ({ ...f, status: "open", exitReason: "open", exitPrice: 100.2, barsHeld: 1 })), stored, "2026-10-01");
  t("plan: an open row with nothing new is left alone", again.updates.length === 0 && again.unchanged === 1);
  t("plan: the key separates side and k", L.signalKey(base()) !== L.signalKey(base({ side: "lower" })) && L.signalKey(base()) !== L.signalKey(base({ k: 2.5 })));
}

// ---------------------------------------------------------------- summary
{
  const row = (over) => ({ symbol: "SPY", assetKind: "equity", sessionDate: "d", entryTimeMs: 1, side: "upper", k: 2, stopK: 3, entryPrice: 1, vwap: 1, sigma: 1, bandPct: 1, volumeZ: 0, volumeClass: "normal", status: "closed", exitReason: "target", exitPrice: 1, barsHeld: 1, fadeReturnPct: 0.1, detectedLagMin: 1, source: "live", ...over });
  const none = L.summarizeSignalLog([]);
  t("summary: empty log says nothing has been seen live yet", none.total === 0 && none.live.n === 0 && none.live.avgReturnPct === null && /No signals/.test(none.note));
  const rows = [row({}), row({ fadeReturnPct: -0.3, exitReason: "stop" }), row({ source: "backfill", fadeReturnPct: 5 }), row({ status: "open", exitReason: "open", fadeReturnPct: 9 })];
  const s = L.summarizeSignalLog(rows);
  t("summary: counts open, closed, live and backfill", s.total === 4 && s.open === 1 && s.closed === 3 && s.liveClosed === 2 && s.backfillClosed === 1, JSON.stringify(s));
  t("summary: only live closed rows count toward the average", near(s.live.avgReturnPct, -0.1) && s.live.n === 2, JSON.stringify(s.live));
  t("summary: win rate and exit mix come from live rows", s.live.winRatePct === 50 && s.live.targetPct === 50 && s.live.stopPct === 50);
  t("summary: under 15 live trades is flagged as a small sample", s.live.smallSample === true && /too few/.test(s.note));
  const many = L.summarizeSignalLog(Array.from({ length: 20 }, (_, i) => row({ fadeReturnPct: i % 2 ? 0.2 : -0.1 })));
  t("summary: 20 live trades is no longer flagged small", many.live.smallSample === false && many.live.ciLowerPct !== null);
  t("summary: wording never recommends", ![s.note, many.note, none.note].some((n) => /\b(buy|sell short|you should|we recommend|go long|go short)\b/i.test(n)));
}

// ---------------------------------------------------------------- Supabase layer against a fake fetch
{
  const calls: any[] = [];
  let respond: (url: string, init: any) => { status: number; body: any } = () => ({ status: 200, body: [] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = respond(url, init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  }) as any;
  const savedEnv = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://example.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

  const rec = { symbol: "SPY", assetKind: "equity", sessionDate: "2026-10-01", entryTimeMs: Date.UTC(2026, 9, 1, 14, 35), side: "lower", k: 2, stopK: 3, entryPrice: 100, vwap: 101, sigma: 0.4, bandPct: 0.8, volumeZ: -1.2, volumeClass: "low", status: "closed", exitReason: "target", exitPrice: 101, barsHeld: 4, fadeReturnPct: 1, detectedLagMin: 3, source: "live" };
  const rt = DB.fromRow({ id: "x", ...DB.toRow(rec) });
  t("db: a record survives the round trip to a row and back", rt.id === "x" && rt.entryTimeMs === rec.entryTimeMs && rt.volumeZ === -1.2 && rt.side === "lower" && rt.source === "live" && rt.fadeReturnPct === 1);
  t("db: numeric columns returned as strings are converted", DB.fromRow({ ...DB.toRow(rec), id: "y", entry_price: "100.5", k: "2" } as any).entryPrice === 100.5);

  await DB.insertSignals([rec]);
  const post = calls[calls.length - 1];
  t("db: insert posts to the table, ignoring duplicates on the unique key", /vwap_signal_log\?on_conflict=symbol,session_date,entry_time,side,k$/.test(post.url) && post.init.method === "POST" && /ignore-duplicates/.test(post.init.headers.Prefer), post.url);
  t("db: insert sends snake_case rows with the service key, never the anon key", JSON.parse(post.init.body)[0].fade_return_pct === 1 && post.init.headers.apikey === "test-key");
  const before = calls.length;
  await DB.insertSignals([]);
  t("db: inserting nothing makes no request", calls.length === before);

  await DB.updateSignal("abc", { status: "closed", exitReason: "stop", exitPrice: 1, barsHeld: 2, fadeReturnPct: -1 });
  const patch = calls[calls.length - 1];
  t("db: update only touches a row that is still open", patch.init.method === "PATCH" && /id=eq\.abc&status=eq\.open/.test(patch.url), patch.url);

  respond = () => ({ status: 200, body: [{ id: "r1", ...DB.toRow(rec) }] });
  const listed = await DB.listSignals("SPY");
  t("db: list reads newest first and maps rows", listed.length === 1 && listed[0].id === "r1" && /order=entry_time\.desc/.test(calls[calls.length - 1].url));
  const forSessions = await DB.signalsForSessions("SPY", ["2026-10-01", "2026-09-30"]);
  t("db: lookup by session dates filters on symbol and dates", forSessions.length === 1 && /session_date=in\./.test(calls[calls.length - 1].url) && /symbol=eq\.SPY/.test(calls[calls.length - 1].url));
  t("db: lookup with no dates makes no request", (await DB.signalsForSessions("SPY", [])).length === 0);

  respond = () => ({ status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.vwap_signal_log' in the schema cache" } });
  let unavailable = false;
  try { await DB.listSignals(null); } catch (e) { unavailable = e instanceof DB.SignalDbUnavailable && /2026-10-08_vwap_signal_log\.sql/.test(e.message); }
  t("db: a missing table is reported as unavailable, with the migration name", unavailable);
  const view = await SVC.readSignalLog("SPY");
  t("service: reading the log with the table missing returns an empty, unavailable view instead of throwing", view.available === false && view.signals.length === 0 && /migration|sql/i.test(view.unavailableReason ?? "") && view.summary.total === 0);

  respond = () => ({ status: 500, body: "boom" });
  const view500 = await SVC.readSignalLog("SPY");
  t("service: any other database error is also reported, not thrown", view500.available === false && /could not be read/.test(view500.unavailableReason ?? ""));

  respond = () => ({ status: 200, body: [{ id: "r1", ...DB.toRow(rec) }] });
  const ok = await SVC.readSignalLog("spy");
  t("service: a working log returns rows and a summary, with the ticker upper-cased", ok.available && ok.signals.length === 1 && ok.summary.liveClosed === 1 && /symbol=eq\.SPY/.test(calls[calls.length - 1].url));

  delete process.env.SUPABASE_URL;
  let noCfg = false;
  try { await DB.listSignals(null); } catch (e) { noCfg = e instanceof DB.SignalDbUnavailable; }
  t("db: no Supabase configuration is reported as unavailable", noCfg);

  globalThis.fetch = realFetch;
  if (savedEnv.u !== undefined) process.env.SUPABASE_URL = savedEnv.u;
  if (savedEnv.k !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.k; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
