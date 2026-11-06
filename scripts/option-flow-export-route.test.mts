// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/option-flow-export-route.test.mts
// /api/cron/option-flow-export (2026-11-06): the read-only export that lets the per-contract detail be saved to files before the prune job nulls it.
// Secret check, argument checks, the day and list reads, the size cap, and proof that it only ever reads. Fake fetch and fake keys; no network.
import { setFakeEnv, install, json, calls, makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();
setFakeEnv({ SUPABASE_URL: "https://fake.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key-0000000000000000000000000000000000" });
process.env.CRON_SECRET = "s3cret";
const route = await import("../src/app/api/cron/option-flow-export/route.ts");
const req = (qs: string, auth = "Bearer s3cret") => new Request(`http://localhost/api/cron/option-flow-export?${qs}`, { headers: auth ? { authorization: auth } : {} });

const contracts = [[0, 735, "p", 382991, 15302, 2.34, 2.34, 2.37, 0.5887]];
const row = (i: number) => ({ symbol: "SPY", snapshot_time: `2026-11-05T14:${String(30 + i).padStart(2, "0")}:00+00`, session_date: "2026-11-05", spot: 737.23, contracts });

// Secret check
install(() => json([]));
t("no Authorization header: 401 and no database call", (await route.GET(req("symbol=SPY&date=2026-11-05", ""))).status === 401 && calls.length === 0);
t("wrong secret: 401", (await route.GET(req("symbol=SPY&date=2026-11-05", "Bearer nope"))).status === 401 && calls.length === 0);
const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
t("CRON_SECRET unset on the server: 401", (await route.GET(req("symbol=SPY&date=2026-11-05", "Bearer undefined"))).status === 401);
process.env.CRON_SECRET = saved;

// Argument checks
t("unknown symbol: 400", (await route.GET(req("symbol=ZZZ&date=2026-11-05"))).status === 400);
t("missing symbol: 400", (await route.GET(req("date=2026-11-05"))).status === 400);
t("bad date: 400", (await route.GET(req("symbol=SPY&date=11/05/2026"))).status === 400);
t("non-numeric offset: 400", (await route.GET(req("symbol=SPY&date=2026-11-05&offset=abc"))).status === 400);
t("none of the rejected requests reached the database", calls.length === 0);

// A day, as stored
install(() => json([row(0), row(5)]));
const ok = await route.GET(req("symbol=SPY&date=2026-11-05"));
const body = await ok.json();
t("a day: 200 with every stored row and its contracts", ok.status === 200 && body.ok && body.count === 2 && body.rows[0].contracts[0][1] === 735 && body.rows[0].spot === 737.23, JSON.stringify(body).slice(0, 160));
t("a day: reads every column for that symbol and date, oldest first", calls.length === 1 && /select=\*/.test(calls[0].url) && /symbol=eq\.SPY/.test(calls[0].url) && /session_date=eq\.2026-11-05/.test(calls[0].url) && /order=snapshot_time\.asc/.test(calls[0].url), calls[0]?.url);
t("the response is not cacheable", ok.headers.get("cache-control") === "no-store");

// Paging arguments reach the query and are clamped
install(() => json([]));
await route.GET(req("symbol=QQQ&date=2026-11-05&offset=40&limit=9999"));
t("offset and limit are passed on, limit capped at 500", /offset=40/.test(calls[0].url) && /limit=500/.test(calls[0].url), calls[0]?.url);

// The days that still have detail
install((u) => json(u.includes("symbol=eq.SPY") ? [{ session_date: "2026-10-23" }, { session_date: "2026-10-23" }, { session_date: "2026-10-26" }] : [{ session_date: "2026-10-26" }]));
const list = await (await route.GET(req("list=1"))).json();
t("list: the distinct dates that still hold detail, per symbol", list.ok && JSON.stringify(list.dates.SPY) === JSON.stringify(["2026-10-23", "2026-10-26"]) && JSON.stringify(list.dates.GLD) === JSON.stringify(["2026-10-26"]) && list.symbols.length === 5, JSON.stringify(list));
t("list: asks only for rows that still have contracts", calls.every((c) => /contracts=not\.is\.null/.test(c.url)) && calls.length === 5);

// Size cap
install(() => json([{ ...row(0), contracts: "x".repeat(4_300_000) }]));
const big = await route.GET(req("symbol=SPY&date=2026-11-05"));
t("over the size cap: 413 telling the caller to page", big.status === 413 && /offset/.test((await big.json()).error));

// Read-only
const all: string[] = [];
install((u, init) => { all.push(init?.method ?? "GET"); return json([]); });
await route.GET(req("symbol=SPY&date=2026-11-05")); await route.GET(req("list=1"));
t("only GET requests are ever sent to the database", all.length > 0 && all.every((m) => m === "GET"), all.join(","));

// Database trouble is reported, not thrown
install(() => json({ message: "boom" }, 400));
t("a database error comes back as a 500 with a message", (await route.GET(req("symbol=SPY&date=2026-11-05"))).status === 500);
delete process.env.SUPABASE_URL;
t("Supabase unconfigured: a clear 503", (await route.GET(req("symbol=SPY&date=2026-11-05"))).status === 503);

summary();
