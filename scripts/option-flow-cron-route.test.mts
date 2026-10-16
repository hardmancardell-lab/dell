// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/option-flow-cron-route.test.mts
// Secret check, session gating and Tradier feed selection of /api/cron/option-flow. The first block needs no network and no database (every case returns before a provider is called); the feed block uses a fake global fetch that serves Tradier and Supabase from memory.

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};

// ---------------------------------------------------------------- the cron route: secret check and session gating (no network, no database)
{
  process.env.CRON_SECRET = "s3cret";
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.TRADIER_ACCESS_TOKEN;
  const route = await import("../src/app/api/cron/option-flow/route.ts");
  const realNow = Date.now;
  const req = (auth?: string) => new Request("http://localhost/api/cron/option-flow", { headers: auth ? { authorization: auth } : {} });
  const r0 = await route.GET(req());
  t("no Authorization header: 401", r0.status === 401);
  t("wrong secret: 401", (await route.GET(req("Bearer nope"))).status === 401);
  Date.now = () => Date.UTC(2026, 9, 17, 15, 0, 0); // Saturday
  const sat = await (await route.GET(req("Bearer s3cret"))).json();
  t("outside the session (Saturday): skipped", sat.skipped === true, JSON.stringify(sat));
  Date.now = () => Date.UTC(2026, 9, 15, 13, 0, 0); // Thursday 9:00 ET
  const pre = await (await route.GET(req("Bearer s3cret"))).json();
  t("before the open: skipped", pre.skipped === true, JSON.stringify(pre));
  Date.now = () => Date.UTC(2026, 9, 15, 20, 0, 0); // 16:00 ET
  const post = await (await route.GET(req("Bearer s3cret"))).json();
  t("at 16:00 ET: skipped", post.skipped === true);
  Date.now = () => Date.UTC(2026, 9, 15, 15, 0, 0); // in session
  const noCfg = await route.GET(req("Bearer s3cret"));
  const noCfgBody = await noCfg.json();
  t("in session with Supabase / Tradier unconfigured: a clear 503 naming what is missing, not a crash", noCfg.status === 503 && /SUPABASE|Tradier|TRADIER/.test(noCfgBody.error ?? ""), JSON.stringify(noCfgBody));
  delete process.env.CRON_SECRET;
  t("CRON_SECRET unset on the server: 401", (await route.GET(req("Bearer undefined"))).status === 401 && (await route.GET(req("Bearer "))).status === 401);
  Date.now = realNow;
}

// ---------------------------------------------------------------- feed selection through the whole route (fake fetch for Tradier and Supabase)
{
  const SB = "sandbox-token-fake", PR = "production-token-fake", SVC = "service-key-fake";
  const FIXED = Date.UTC(2026, 9, 15, 15, 0, 0); // Thursday 11:00 ET, in session
  const realNow = Date.now, realFetch = globalThis.fetch;
  const envKeys = ["CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MARKET_DATA_MOCK_MODE", "TRADIER_ACCESS_TOKEN", "TRADIER_PRODUCTION_TOKEN", "OPTION_FLOW_TRADIER_MODE"];
  const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  const route = await import("../src/app/api/cron/option-flow/route.ts");

  let calls: { host: string; path: string; method: string; auth: string | null; body: any }[] = [];
  let nearAgeMs = 900_000;
  const contracts = () => {
    const out: any[] = [];
    for (const type of ["call", "put"]) {
      for (let k = 60; k <= 230; k++) {
        out.push({ strike: k, expiration_date: "2026-10-16", option_type: type, bid: 1, ask: 1.2, last: 1.1, volume: 3, open_interest: 5, bid_date: FIXED - nearAgeMs, ask_date: FIXED - nearAgeMs - 1000, greeks: { mid_iv: 0.25 } });
      }
    }
    // Far from every mocked spot (80-205) and newer than everything else: must not influence the lag.
    out.push({ strike: 10, expiration_date: "2026-10-16", option_type: "call", bid: 1, ask: 1.2, last: 1.1, volume: 3, open_interest: 5, bid_date: FIXED - 1000 });
    return out;
  };
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ host: url.host, path: url.pathname, method: init.method ?? "GET", auth: init.headers?.Authorization ?? null, body });
    if (url.host === "sandbox.tradier.com" || url.host === "api.tradier.com") {
      if (url.pathname.endsWith("/markets/options/expirations")) return new Response(JSON.stringify({ expirations: { date: ["2026-10-15", "2026-10-16"] } }), { status: 200 });
      if (url.pathname.endsWith("/markets/options/chains")) return new Response(JSON.stringify({ options: { option: contracts() } }), { status: 200 });
    }
    if (url.host === "supa.test") return init.method === "POST" ? new Response(null, { status: 201 }) : new Response("[]", { status: 200 });
    return new Response("unexpected host", { status: 500 });
  }) as any;

  const setEnv = (e: Record<string, string | undefined>) => {
    for (const k of envKeys) delete process.env[k];
    process.env.CRON_SECRET = "s3cret"; process.env.SUPABASE_URL = "https://supa.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = SVC; process.env.MARKET_DATA_MOCK_MODE = "true";
    for (const [k, v] of Object.entries(e)) if (v !== undefined) process.env[k] = v;
  };
  const run = async () => {
    calls = [];
    Date.now = () => FIXED;
    const res = await route.GET(new Request("http://localhost/api/cron/option-flow", { headers: { authorization: "Bearer s3cret" } }));
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text), calls: [...calls] };
  };
  const tradierCalls = (r) => r.calls.filter((x) => /tradier\.com$/.test(x.host));
  const upserts = (r) => r.calls.filter((x) => x.host === "supa.test" && x.method === "POST").map((x) => x.body);

  try {
    // 1. production requested, token missing: loud failure, nothing fetched or written (not even a Supabase read).
    setEnv({ OPTION_FLOW_TRADIER_MODE: "production", TRADIER_ACCESS_TOKEN: SB });
    let r = await run();
    t("production requested without TRADIER_PRODUCTION_TOKEN: 503 naming the missing variable", r.status === 503 && /TRADIER_PRODUCTION_TOKEN/.test(r.json.error ?? ""), r.text);
    t("... and no request of any kind was made (no Tradier, no Supabase, no writes), despite the sandbox token being set", r.calls.length === 0, JSON.stringify(r.calls.map((x) => x.host)));

    // 2. unknown mode value: loud failure too.
    setEnv({ OPTION_FLOW_TRADIER_MODE: "prod", TRADIER_ACCESS_TOKEN: SB, TRADIER_PRODUCTION_TOKEN: PR });
    r = await run();
    t("unrecognised OPTION_FLOW_TRADIER_MODE: 503 and no request made", r.status === 503 && /unrecognised/.test(r.json.error ?? "") && r.calls.length === 0, r.text);

    // 3. default: mode unset, both tokens present -> sandbox, sandbox token, rows labelled sandbox.
    setEnv({ TRADIER_ACCESS_TOKEN: SB, TRADIER_PRODUCTION_TOKEN: PR });
    r = await run();
    t("default mode runs and reports dataFeed sandbox", r.status === 200 && r.json.dataFeed === "sandbox" && r.json.okCount === 5, r.text.slice(0, 300));
    t("default mode: every Tradier request goes to sandbox.tradier.com with the sandbox token, even though a production token exists", tradierCalls(r).length > 0 && tradierCalls(r).every((x) => x.host === "sandbox.tradier.com" && x.auth === `Bearer ${SB}`));
    let up = upserts(r);
    t("default mode: 5 rows written, all data_feed 'sandbox', quote_lag_seconds 900 (far strike ignored)", up.length === 5 && up.every((x) => x.data_feed === "sandbox" && x.quote_lag_seconds === 900), JSON.stringify(up.map((x) => [x.symbol, x.data_feed, x.quote_lag_seconds])));
    t("default mode: only sandbox.tradier.com and the database host were contacted", r.calls.every((x) => x.host === "sandbox.tradier.com" || x.host === "supa.test"));

    // 4. explicit sandbox behaves the same.
    setEnv({ OPTION_FLOW_TRADIER_MODE: "sandbox", TRADIER_ACCESS_TOKEN: SB, TRADIER_PRODUCTION_TOKEN: PR });
    r = await run();
    t("OPTION_FLOW_TRADIER_MODE=sandbox: sandbox host only, rows 'sandbox'", r.status === 200 && tradierCalls(r).every((x) => x.host === "sandbox.tradier.com" && x.auth === `Bearer ${SB}`) && upserts(r).every((x) => x.data_feed === "sandbox"));

    // 5. production with the token: production host, production token, rows 'production'. The sandbox token is not needed.
    nearAgeMs = 4_000;
    setEnv({ OPTION_FLOW_TRADIER_MODE: "production", TRADIER_PRODUCTION_TOKEN: PR });
    r = await run();
    t("production mode runs and reports dataFeed production (TRADIER_ACCESS_TOKEN not required)", r.status === 200 && r.json.dataFeed === "production" && r.json.okCount === 5, r.text.slice(0, 300));
    t("production mode: every Tradier request goes to api.tradier.com/v1 with the production token", tradierCalls(r).length > 0 && tradierCalls(r).every((x) => x.host === "api.tradier.com" && x.path.startsWith("/v1/") && x.auth === `Bearer ${PR}`));
    up = upserts(r);
    t("production mode: rows written with data_feed 'production' and a few seconds of quote lag", up.length === 5 && up.every((x) => x.data_feed === "production" && x.quote_lag_seconds === 4), JSON.stringify(up.map((x) => [x.symbol, x.data_feed, x.quote_lag_seconds])));
    t("production mode: only api.tradier.com and the database host were contacted", r.calls.every((x) => x.host === "api.tradier.com" || x.host === "supa.test"));
    t("only option market-data paths were requested from Tradier", tradierCalls(r).every((x) => /^\/v1\/markets\/options\/(expirations|chains)$/.test(x.path)) && !tradierCalls(r).some((x) => /account|order|watchlist|user/i.test(x.path)));
    t("the mode value in other case and with spaces is accepted", await (async () => { setEnv({ OPTION_FLOW_TRADIER_MODE: " PRODUCTION ", TRADIER_PRODUCTION_TOKEN: PR }); const x = await run(); return x.status === 200 && x.json.dataFeed === "production"; })());

    // 6. sandbox mode without the sandbox token: fails, and does NOT borrow the production token.
    setEnv({ TRADIER_PRODUCTION_TOKEN: PR });
    r = await run();
    t("sandbox mode without TRADIER_ACCESS_TOKEN: 503 and the production token is not used instead", r.status === 503 && /TRADIER_ACCESS_TOKEN/.test(r.json.error ?? "") && tradierCalls(r).length === 0, r.text);

    // 7. no response or error text ever echoes a token value.
    t("no response body contains a token value", ![SB, PR, SVC].some((v) => r.text.includes(v)));
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
    for (const k of envKeys) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  }
}

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
