// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/option-flow-cron-route.test.mts
// Secret check and session gating of /api/cron/option-flow. No network, no database: every case returns before a provider is called.

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

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
