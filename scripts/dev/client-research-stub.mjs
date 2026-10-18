// A stand-in Supabase REST server with ONE fictional test client, so the client portal and its Research section can be
// exercised locally without touching the real database or any real client.
//
//   node scripts/dev/client-research-stub.mjs            (listens on http://127.0.0.1:4010)
//
// Then start the app pointing at it (these override .env.local because real environment variables win):
//   SUPABASE_URL=http://127.0.0.1:4010 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4010 SUPABASE_SERVICE_ROLE_KEY=stub \
//   ACCESS_COOKIE_KEY=local-test-only SITE_ACCESS_PASSWORD= npm run dev
//
// The test clients start with the OLD unsalted hash on purpose, so a first sign-in shows the upgrade to the salted hash.
// TEST CLIENT (fiction, not a person): open /client/test-research-client and use the passcode below.
export const TEST_SLUG = "test-research-client";
export const TEST_PASSCODE = "research-demo-0000"; // test value for this stub only; never a real passcode
// A second fictional client, used to check that one client cannot see another's data.
export const OTHER_SLUG = "test-other-client";
export const OTHER_PASSCODE = "other-demo-0000";

import http from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const sha = (s) => createHash("sha256").update(s.trim()).digest("hex");
const clients = [
  { id: "stub-1", slug: TEST_SLUG, name: "Test Research Client (fictional)", passcode_hash: sha(TEST_PASSCODE), cash_balance: 5000, linked_email: null, user_id: null, created_at: "2026-10-01T00:00:00Z" },
  { id: "stub-2", slug: OTHER_SLUG, name: "Other Test Client (fictional)", passcode_hash: sha(OTHER_PASSCODE), cash_balance: 100, linked_email: null, user_id: null, created_at: "2026-10-01T00:00:00Z" },
];
const h = (client_id, symbol, asset_class, shares, cost, extra = {}) => ({
  id: `${client_id}-${symbol}`, client_id, symbol, asset_class, shares, cost_basis_per_share: cost, acquired_date: "2025-06-02",
  option_right: null, strike_price: null, expiration_date: null, underlying_symbol: null, contract_multiplier: null, created_at: "2026-10-01T00:00:00Z", ...extra,
});
const holdings = [
  h("stub-1", "NVDA", "equity", 10, 120),
  h("stub-1", "AAPL", "equity", 5, 150),
  h("stub-1", "BTC-USD", "crypto", 0.05, 40000),
  h("stub-2", "TSLA", "equity", 3, 200),
];
const outlook = {
  meta: { versionId: "stub-v1", asOfDate: "2026-10-12", refreshReason: "scheduled_fomc_cycle", priorVersionId: null, nextScheduledRefresh: "2026-11-05" },
  regimeTag: { label: "TEST FIXTURE: late-cycle slowdown", cyclePhase: "late_expansion", dualMandateBalance: "Test data. Inflation is the bigger worry in this fixture.", financialConditionsStance: "tight" },
  dualMandateScorecard: { labor: [{ indicator: "Unemployment rate", currentReading: "4.3% (test value)", roleInOutlook: "Shows slack in the job market.", howDerived: "fixture", source: "BLS (fixture)", lastChangedMeaningfully: null }], inflation: [{ indicator: "Core CPI, year on year", currentReading: "3.1% (test value)", roleInOutlook: "Shows price pressure.", howDerived: "fixture", source: "BLS (fixture)", lastChangedMeaningfully: null }] },
  growthAndFinancialConditions: [],
  policyStance: { currentTargetRange: "4.00% to 4.25% (test value)", houseViewPath: "One cut by year end (test value)", marketImpliedPath: "Two cuts by year end (test value)", gapAnalysis: "SHOULD NOT REACH THE CLIENT" },
  riskBalance: { upsideRisks: [{ scenario: "Inflation falls faster than expected.", trigger: "Core CPI prints under 0.2% for two months.", marketImplication: "Bond yields fall." }], downsideRisks: [{ scenario: "Job losses speed up.", trigger: "Unemployment rises 0.5 points in a quarter.", marketImplication: "Stocks may fall as growth hopes fade." }] },
  selfQa: [{ question: "q", answer: "SHOULD NOT REACH THE CLIENT", falsificationTrigger: "SHOULD NOT REACH THE CLIENT" }],
  tradingParameters: { volRegime: "elevated_event_risk", calendarEffectsPriority: ["SHOULD NOT REACH THE CLIENT"], eventVolCatalysts: [], meanReversionWindowConfidence: "SHOULD NOT REACH THE CLIENT" },
  outputLayers: { glance: "Test fixture: growth is slowing while inflation stays sticky.", narrativeRef: "x", triggerFeed: ["SHOULD NOT REACH THE CLIENT"] },
  scorecardLogRef: "x",
  dataLimitations: ["This is a fixture served by the local stub. It is not a real outlook."],
};
const scorecard = [
  { version_id: "stub-v0", logged_date: "2026-08-01", regime_tag_at_call: "x", house_view_path_at_call: "x", key_falsification_triggers: [], grading: { gradedDate: "2026-09-20", didTriggersFire: false, actualFedAction: null, actualMarketReaction: null, wasRegimeTagCorrect: true, wasHouseViewPathCorrect: false, notesOnWhatBrokeOrHeld: "SHOULD NOT REACH THE CLIENT", lessonForNextVersion: null } },
  { version_id: "stub-v1", logged_date: "2026-10-12", regime_tag_at_call: "x", house_view_path_at_call: "x", key_falsification_triggers: [], grading: { gradedDate: null } },
];

export function startStub(port = 4010) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const send = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const t = url.pathname.replace("/rest/v1/", "");
    const eq = (k) => (url.searchParams.get(k) ?? "").replace(/^eq\./, "");
    if (req.method === "PATCH" && t === "advisor_clients") {
      // Compare-and-set like PostgREST: the passcode hash upgrade only applies if the stored hash is still the old one.
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const row = clients.find((c) => c.slug === eq("slug") && (!url.searchParams.has("passcode_hash") || c.passcode_hash === eq("passcode_hash")));
        if (!row) return send([]);
        Object.assign(row, JSON.parse(raw || "{}"));
        send([row]);
      });
      return;
    }
    if (t === "advisor_clients") return send(url.searchParams.has("slug") ? clients.filter((c) => c.slug === eq("slug")) : clients);
    if (t === "advisor_client_holdings") return send(holdings.filter((x) => x.client_id === eq("client_id")));
    if (t === "advisor_client_sales" || t === "advisor_client_realized_pnl") return send([]);
    if (t === "economic_outlook_versions") return send([{ version_id: "stub-v1", as_of_date: "2026-10-12", refresh_reason: "x", prior_version_id: null, regime_label: "x", data: outlook, created_at: "2026-10-12T00:00:00Z" }]);
    if (t === "economic_outlook_scorecard") return send(scorecard);
    return send([]);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await startStub(Number(process.env.STUB_PORT ?? 4010));
  console.log("client-research stub on http://127.0.0.1:" + (process.env.STUB_PORT ?? 4010) + " (test client slug: " + TEST_SLUG + ")");
}
