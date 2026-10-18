// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/news-impact-routes.test.mts
// News Impact server side with no network and no key: the daily headline-log cron route (secret, config, merge without double
// counting, no headline text stored, missing-table message), the /api/news-impact route (input checks, rate limit, plain
// errors), and the data parsers (SEC columns, BLS archive links). Every fetch is a fake; any other URL throws.
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-12345";
process.env.CRON_SECRET = "s3cret";
process.env.SEC_EDGAR_USER_AGENT = "Test test@example.com";
delete process.env.FMP_API_KEY;

type Handler = (url: string, init: any) => Response | Promise<Response> | null;
let handlers: Handler[] = [];
const calls: { url: string; init: any }[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  calls.push({ url, init });
  for (const h of handlers) {
    const r = await h(url, init);
    if (r) return r;
  }
  throw new Error("BLOCKED " + url);
}) as any;

const P = await import("../src/lib/data/provider-http.ts");
P.setProviderSleep(async () => {});
const H = await import("../src/lib/news/news-hub.ts");

const rss = (items: { title: string; link: string; pubDate: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pubDate}</pubDate></item>`).join("")}</channel></rss>`;
const xml = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
const secOff: Handler = (url) => (url.includes("sec.gov") ? new Response("down", { status: 500 }) : null);

// ------------------------------------------------------------------ headline-log cron route
{
  const route = await import("../src/app/api/cron/news-headline-log/route.ts");
  const req = (auth?: string) => new Request("http://localhost/api/cron/news-headline-log", { headers: auth ? { authorization: auth } : {} });
  t("cron: no Authorization header is 401", (await route.GET(req())).status === 401);
  t("cron: wrong secret is 401", (await route.GET(req("Bearer nope"))).status === 401);

  // in-memory Supabase
  const store = new Map<string, any>();
  let tableMissing = false;
  const sb: Handler = async (url, init) => {
    if (!url.startsWith("https://fake.supabase.test/rest/v1/news_headline_counts")) return null;
    if (tableMissing) return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table in the schema cache" }), { status: 404 });
    const u = new URL(url);
    if (init.method === "GET") {
      const sym = u.searchParams.get("symbol")?.replace("eq.", "");
      const rows = [...store.values()].filter((r) => r.symbol === sym);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      store.set(`${body.symbol}|${body.count_date}`, body);
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 204 });
  };
  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date(Date.now() - 3600_000).toUTCString().replace("GMT", "+0000");
  const feed = (titles: string[]) => (url: string) => (url.includes("feeds.finance.yahoo.com") ? xml(rss(titles.map((title, i) => ({ title, link: `https://news.example/${i}-${title.length}`, pubDate: stamp })))) : null);

  H.clearNewsHubCaches();
  handlers = [sb, feed(["Chipmaker unveils new data center processor line", "Analysts weigh supply limits at the foundry this quarter"]), secOff];
  const r1 = await route.GET(req("Bearer s3cret"));
  const b1 = await r1.json();
  t("cron: a good run stores counts for every logged symbol and answers 200 ok", r1.status === 200 && b1.ok === true && b1.okCount === 7 && b1.failedCount === 0, JSON.stringify(b1).slice(0, 300));
  const rows1 = [...store.values()].filter((r) => r.symbol === "NVDA");
  t("cron: one row per symbol per date with the count, outlet counts and the capture number", rows1.length >= 1 && rows1.reduce((s, r) => s + r.headline_count, 0) === 2 && rows1[0].captures === 1, JSON.stringify(rows1[0]));
  const posted = calls.filter((c) => c.init?.method === "POST").map((c) => c.init.body).join(" ");
  t("cron: no headline text and no link is ever sent to the database", !/Chipmaker|foundry|processor line|https?:\/\//.test(posted));
  t("cron: no key in the response body", !JSON.stringify(b1).includes("fake-service-role-key") && !JSON.stringify(b1).includes("s3cret"));

  H.clearNewsHubCaches();
  const r2 = await route.GET(req("Bearer s3cret"));
  await r2.json();
  const rows2 = [...store.values()].filter((r) => r.symbol === "NVDA");
  t("cron: running again with the same headlines does not double count; captures goes to 2", rows2.reduce((s, r) => s + r.headline_count, 0) === 2 && rows2[0].captures === 2, JSON.stringify(rows2[0]));

  H.clearNewsHubCaches();
  handlers = [sb, feed(["Chipmaker unveils new data center processor line", "Analysts weigh supply limits at the foundry this quarter", "Regulators open review of chip export licenses today"]), secOff];
  await (await route.GET(req("Bearer s3cret"))).json();
  const rows3 = [...store.values()].filter((r) => r.symbol === "NVDA");
  t("cron: a new headline on a later run adds exactly one", rows3.reduce((s, r) => s + r.headline_count, 0) === 3, JSON.stringify(rows3.map((r) => r.headline_count)));

  H.clearNewsHubCaches();
  tableMissing = true;
  const r4 = await route.GET(req("Bearer s3cret"));
  const b4 = await r4.json();
  t("cron: a missing table is a 503 that names the migration file", r4.status === 503 && /2026-10-18_news_headline_counts\.sql/.test(b4.error ?? ""), JSON.stringify(b4));
  tableMissing = false;

  H.clearNewsHubCaches();
  handlers = [sb, (url) => (url.includes("yahoo") ? new Response("x", { status: 503 }) : null), secOff];
  const r5 = await route.GET(req("Bearer s3cret"));
  t("cron: when no feed answers, nothing is stored and the run is not 200 (the workflow goes red)", r5.status === 502, String(r5.status));

  delete process.env.SUPABASE_URL;
  const r6 = await route.GET(req("Bearer s3cret"));
  t("cron: Supabase not configured is a plain 503", r6.status === 503 && /not configured/.test((await r6.json()).error));
  process.env.SUPABASE_URL = "https://fake.supabase.test";
}

// ------------------------------------------------------------------ /api/news-impact route
{
  const route = await import("../src/app/api/news-impact/route.ts");
  const get = (qs: string, ip = "10.0.0.1") => route.GET(new Request(`http://localhost/api/news-impact?${qs}`, { headers: { "x-forwarded-for": ip } }));
  t("impact route: a missing ticker is a 400 with a plain sentence", (await get("assetClass=equity", "10.0.1.1")).status === 400);
  const bad = await get("ticker=%3Cscript%3E&assetClass=equity", "10.0.1.2");
  t("impact route: a ticker with odd characters is a 400", bad.status === 400 && /letters and numbers/.test((await bad.json()).error));
  const cls = await get("ticker=AAPL&assetClass=bananas", "10.0.1.3");
  t("impact route: an unknown asset class is a 400", cls.status === 400 && /Unknown asset type/.test((await cls.json()).error));

  handlers = [() => new Response("nope", { status: 503 })];
  const fail = await get("ticker=ZZTEST&assetClass=crypto", "10.0.1.4");
  const fb = await fail.json();
  t("impact route: when prices cannot be loaded the answer is a plain error, with no URL, key or stack in it", fail.status >= 500 && typeof fb.error === "string" && !/https?:|fake-service|stack|at file/.test(fb.error), JSON.stringify(fb));
  const lim = [];
  for (let i = 0; i < 14; i++) lim.push((await get("ticker=%24%24", "10.0.2.9")).status);
  t("impact route: the 13th request in a minute from one address is rate limited (429)", lim.slice(0, 12).every((s) => s === 400) && lim[12] === 429, lim.join());
}

// ------------------------------------------------------------------ data parsers
{
  const D = await import("../src/lib/news-impact/data.ts");
  const cols = {
    form: ["8-K", "4", "10-Q", "8-K", "8-K"],
    filingDate: ["2026-10-01", "2026-10-02", "2026-08-01", "2019-01-01", "2026-09-01"],
    acceptanceDateTime: ["2026-10-01T20:30:00.000Z", "2026-10-02T10:00:00.000Z", "2026-08-01T12:00:00.000Z", "2019-01-01T12:00:00.000Z", ""],
    items: ["2.02,9.01", "", "", "5.02", "7.01"],
  };
  const rows = D.rowsFromColumns(cols, "2021-01-01");
  t("rowsFromColumns: keeps 8-K/10-K/10-Q since the date, drops insider forms and old filings, keeps item codes and times", rows.length === 3 && rows[0].items === "2.02,9.01" && rows[0].acceptanceDateTime === "2026-10-01T20:30:00.000Z" && rows[2].acceptanceDateTime === null, JSON.stringify(rows));
  t("rowsFromColumns: missing columns give an empty list, not a crash", D.rowsFromColumns(undefined, "2021-01-01").length === 0 && D.rowsFromColumns({}, "2021-01-01").length === 0);
  const html = `<li><a href="/news.release/archives/cpi_10142026.htm">September 2026 CPI</a></li><li><a href="/news.release/archives/cpi_11132026.htm">October</a></li><li><a href="/news.release/archives/cpi_12102025.htm">Nov 2025</a></li><a href="/news.release/archives/cpi_12102025.pdf">PDF</a><a href="/news.release/archives/empsit_10022026.htm">x</a>`;
  const ds = D.parseBlsArchiveDates(html, "cpi", "2025-06-01", "2026-10-18");
  t("parseBlsArchiveDates: reads MMDDYYYY from the archive links, drops future dates, de-duplicates, ignores other releases", JSON.stringify(ds) === JSON.stringify(["2025-12-10", "2026-10-14"]), JSON.stringify(ds));
  // FRED release dates: sorted, filtered to the window, and a failure never leaks the key; then the fallback to the BLS archive
  process.env.FRED_API_KEY = "FAKE_FRED_KEY_98765";
  const today = new Date().toISOString().slice(0, 10);
  const many = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2024, i % 12, 1 + i)).toISOString().slice(0, 10));
  handlers = [(url) => (url.includes("api.stlouisfed.org/fred/release/dates") ? new Response(JSON.stringify({ release_dates: [...many.map((d) => ({ date: d })), { date: "2999-01-01" }, { date: "1999-01-01" }, { date: "junk" }] }), { status: 200 }) : null)];
  const fr = await D.fetchFredReleaseDates(10, "2020-01-01");
  const frUrl = calls.filter((c) => c.url.includes("release/dates")).pop().url;
  t("fetchFredReleaseDates: asks for the right release, drops future, ancient and malformed dates, returns ascending", /release_id=10/.test(frUrl) && fr.length === 30 && fr.every((d, i) => i === 0 || fr[i - 1] <= d) && !fr.includes("2999-01-01"), JSON.stringify(fr.slice(0, 3)));
  handlers = [(url) => (url.includes("api.stlouisfed.org") ? new Response(JSON.stringify({ error_message: "bad key FAKE_FRED_KEY_98765" }), { status: 400 }) : null)];
  const bad = await D.fetchFredReleaseDates(10, "2020-01-01").then(() => null, (e) => e);
  t("fetchFredReleaseDates: a FRED failure is an error that does not contain the key or the URL", bad instanceof Error && !/FAKE_FRED_KEY|api_key|https?:/.test(bad.message), String(bad && bad.message));
  const blsHtml = Array.from({ length: 15 }, (_, i) => `<a href="/news.release/archives/cpi_${String(1 + (i % 9)).padStart(2, "0")}1${String(1 + (i % 9))}2024.htm">x</a>`).join("") + Array.from({ length: 15 }, (_, i) => `<a href="/news.release/archives/cpi_${String(1 + (i % 12)).padStart(2, "0")}15${2020 + Math.floor(i / 12)}.htm">y</a>`).join("");
  handlers = [(url) => (url.includes("api.stlouisfed.org") ? new Response("no", { status: 400 }) : null), (url) => (url.includes("bls.gov/bls/news-release/cpi.htm") ? new Response(blsHtml, { status: 200 }) : null)];
  const viaBls = await D.releaseDates("cpi", "2019-01-01");
  t("releaseDates: when FRED fails it falls back to the BLS archive page", Array.isArray(viaBls) && viaBls.length >= 12, JSON.stringify(viaBls && viaBls.length));
  handlers = [(url) => new Response("no", { status: 500 })];
  t("releaseDates: when neither answers it returns null (the macro test then says dates were missing)", (await D.releaseDates("jobs", "2019-01-01")) === null);
  delete process.env.FRED_API_KEY;
  t("parseBlsArchiveDates: an unexpected page gives an empty list", D.parseBlsArchiveDates("<html>blocked</html>", "cpi", "2020-01-01", "2026-10-18").length === 0);
}

summary();
