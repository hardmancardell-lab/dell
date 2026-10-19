// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/option-colors.test.mts
// The three options views share one call/put colour pair (src/components/option-colors.tsx): calls teal (--signal), puts amber
// (--verdict). This guards against the old clashes coming back: danger red on puts, off-token hex for calls and puts, and a
// call/put colour reused for a series that is not a call or a put.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(ROOT + p, "utf8");
let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "\n  " + detail); };

const shared = read("src/components/option-colors.tsx");
t("shared pair is the Jarvis signal teal for calls and verdict amber for puts", /CALL_COLOR = "var\(--signal\)"/.test(shared) && /PUT_COLOR = "var\(--verdict\)"/.test(shared), "");
t("the shared pair never uses the danger red", !/CALL_COLOR = .*danger|PUT_COLOR = .*danger/.test(shared), "");

for (const f of ["OptionsChainTradeTab", "GammaHeatMapTab", "OptionFlowTab"]) {
  const src = read(`src/components/${f}.tsx`);
  t(`${f} takes its call and put colours from the shared pair`, /from "\.\/option-colors"/.test(src), "");
  t(`${f} has a call/put legend`, /<CallPutLegend/.test(src), "");
}
const chain = read("src/components/OptionsChainTradeTab.tsx");
const putAt = chain.indexOf("Trade the ${row.strike} put");
t("Options chain: the put Trade button is not danger red", putAt > 0 && !chain.slice(putAt, putAt + 200).includes("--danger"), "");
t("Options chain: both Trade buttons have an accessible name", /aria-label=\{`Trade the \$\{row\.strike\} call`\}/.test(chain) && /aria-label=\{`Trade the \$\{row\.strike\} put`\}/.test(chain), "");
const gamma = read("src/components/GammaHeatMapTab.tsx");
t("Gamma map: the old off-token call/put hex values are gone", !/#3987e5|#d95926|#34a89f/i.test(gamma), "");
t("Gamma map: the Net view (dealer sign, not calls versus puts) does not use the call/put colours", /view === "net"\) return v >= 0 \? NET_LONG_COLOR : NET_SHORT_COLOR/.test(gamma), "");
const flow = read("src/components/OptionFlowTab.tsx");
t("Option flow: ratio series do not reuse the teal or amber hues", !/#34a89f|#e0b020/i.test(flow), "");

console.log(`\n${passed} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
