// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/long-haul.test.mts
// The pedagogy audit's 1-D replica of The Long Haul, now driven by the SAME pure functions the shipped engine calls
// (long-haul-rules.ts), so the model cannot drift from the game. Audit finding: the loan offer never appeared on the
// highway lane in 24,000 modeled runs, and the loan never cost more than its flat $50.
import { TRACK, VEHICLE, TRAILER, ECONOMY, XP } from "../../src/lib/agents/financial-literacy/skills/long-haul-content.ts";
import { stepSpeed, fuelAfter, shouldOfferLoan, takeLoan, advanceLoan, NO_LOAN, ROLLOVER_FEE } from "../../src/lib/agents/financial-literacy/skills/long-haul-rules.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

// Mirrors LongHaulEngine.animate()/currentTuning() on the z axis (steering, walls and lane changes are not modeled).
function run({ duty, lane, accept, rng, dt = 1 / 60 }: { duty: number; lane: "highway" | "back"; accept: boolean; rng: () => number; dt?: number }) {
  let z = 0, speed = 0, fuel = 100, time = 0, trailer = false, loan = NO_LOAN, resolved = false, prompted = false, toll = 0, tollDone = false, fuelAtStation = NaN;
  let throttleOn = true, nextSwitch = 0;
  while (z > TRACK.finishZ && time < 600) {
    if (time >= nextSwitch) { throttleOn = rng() < duty; nextSwitch += 0.5; }
    const rough = lane === "back" && z < TRACK.laneSplitStartZ && z > TRACK.laneSplitEndZ ? VEHICLE.roughSurfaceSpeedMult : 1;
    const mult = trailer ? { m: TRAILER.maxSpeedMult, a: TRAILER.accelMult } : { m: 1, a: 1 };
    const tuning = { maxSpeed: VEHICLE.baseMaxSpeed * mult.m * rough * (fuel <= 0 ? VEHICLE.outOfFuelSpeedMult : 1), accel: VEHICLE.baseAccel * mult.a };
    speed = stepSpeed(speed, throttleOn ? 1 : 0, tuning, dt);
    fuel = fuelAfter(fuel, throttleOn, dt);
    loan = advanceLoan(loan, dt);
    z -= speed * dt; time += dt;
    if (!tollDone && z <= TRACK.tollZ && lane === "highway") { tollDone = true; toll += ECONOMY.tollCost; }
    if (!resolved && z <= TRACK.gasStationZ) {
      resolved = true; fuelAtStation = fuel;
      if (shouldOfferLoan(fuel)) { prompted = true; speed = 0; if (accept) { trailer = true; loan = takeLoan(); fuel = 100; } }
    }
  }
  return { time, prompted, tookLoan: trailer, debt: loan.debt, rollovers: loan.rollovers, toll, fuelAtStation, finished: z <= TRACK.finishZ };
}

// ---- 1. the loan offer now appears on the highway lane (it never did before)
const full = run({ duty: 1, lane: "highway", accept: false, rng: () => 0 });
t("highway, full throttle: loan offered at the gas station", full.prompted, `fuel at station ${full.fuelAtStation.toFixed(1)}`);
t(`highway, full throttle reaches the station below the ${TRACK.gasStationFuelThreshold} threshold`, full.fuelAtStation < TRACK.gasStationFuelThreshold, full.fuelAtStation.toFixed(1));
const backFull = run({ duty: 1, lane: "back", accept: false, rng: () => 0 });
t("back road, full throttle: loan offered", backFull.prompted);
const half = run({ duty: 0.5, lane: "highway", accept: false, rng: mulberry32(11) });
t("highway at about half throttle can still finish clean (no loan offered)", !half.prompted && half.finished, `fuel ${half.fuelAtStation.toFixed(1)}`);

// ---- 2. seeded matrix (2 lanes x 6 throttle duties x 2 policies x 400 runs = 4,800)
const rows: any[] = [];
for (const lane of ["highway", "back"] as const) for (const duty of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) for (const accept of [false, true]) {
  const rng = mulberry32(7 + Math.round(duty * 100)); let prompts = 0, finished = 0, sumDebt = 0, sumT = 0, took = 0; const N = 400;
  for (let n = 0; n < N; n++) { const r = run({ duty, lane, accept, rng }); if (r.prompted) prompts++; if (r.finished) finished++; if (r.tookLoan) { took++; sumDebt += r.debt; } sumT += r.time; }
  rows.push({ lane, duty, accept, pctPrompted: +(100 * prompts / N).toFixed(1), pctFinished: +(100 * finished / N).toFixed(1), meanDebtIfBorrowed: took ? +(sumDebt / took).toFixed(2) : 0, meanTime: +(sumT / N).toFixed(1) });
}
if (process.argv.includes("--table")) console.table(rows);
const hw = rows.filter((r) => r.lane === "highway" && !r.accept);
const bk = rows.filter((r) => r.lane === "back" && !r.accept);
const pr = (rs: any[], d: number) => rs.find((r) => r.duty === d).pctPrompted;
t("highway: loan offered in at least 99% of runs at full or 0.9 throttle", pr(hw, 1) >= 99 && pr(hw, 0.9) >= 99, JSON.stringify(hw.map((r) => [r.duty, r.pctPrompted])));
t("highway: roughly half of 0.7-throttle runs are offered the loan (a real decision, not a certainty)", pr(hw, 0.7) >= 40 && pr(hw, 0.7) <= 75, String(pr(hw, 0.7)));
t("highway: fuel management matters (offered far less at 0.5 throttle than at full)", pr(hw, 0.5) <= 40 && pr(hw, 1) - pr(hw, 0.5) >= 50);
t("highway offer rate falls as the player eases off (monotone within noise)", hw.every((r, i) => i === 0 || r.pctPrompted <= hw[i - 1].pctPrompted + 3));
t("back road: loan offered in at least 85% of runs at every throttle (rough road burns fuel)", bk.every((r) => r.pctPrompted >= 85), JSON.stringify(bk.map((r) => [r.duty, r.pctPrompted])));
t("every modeled run finishes (declining never strands the car)", rows.every((r) => r.pctFinished === 100));
t("anyone who takes the loan owes more than the $50 borrowed", rows.filter((r) => r.accept && r.meanDebtIfBorrowed > 0).every((r) => r.meanDebtIfBorrowed > ECONOMY.loanAmount), JSON.stringify(rows.filter((r) => r.accept).map((r) => [r.lane, r.duty, r.meanDebtIfBorrowed])));

// ---- 3. the loan accrues fees: principal never shrinks, each rollover adds the payday fee
t("rollover fee is $7.50 on $50 at 391% (15 dollars per 100 for 14 days)", ROLLOVER_FEE === 7.5, String(ROLLOVER_FEE));
let s = takeLoan();
t("a new loan starts at the borrowed $50", s.debt === 50 && s.rollovers === 0);
s = advanceLoan(s, ECONOMY.rolloverIntervalSeconds - 0.01);
t("no fee before the first interval passes", s.debt === 50);
s = advanceLoan(s, 0.02);
t("first rollover adds one fee ($57.50)", s.debt === 57.5 && s.rollovers === 1, String(s.debt));
s = advanceLoan(s, ECONOMY.rolloverIntervalSeconds * 5);
t("six rollovers cost $45 in fees and the principal is never paid down ($95)", s.debt === 95 && s.rollovers === 6, `${s.debt} ${s.rollovers}`);
t("advanceLoan is a no-op without a loan", advanceLoan(NO_LOAN, 100).debt === 0);
let d0 = 0, mono = true; let ls = takeLoan(); for (let i = 0; i < 2000; i++) { ls = advanceLoan(ls, 1 / 60); if (ls.debt < d0) mono = false; d0 = ls.debt; }
t("debt never decreases over time", mono);

// ---- 4. rules sanity
t("a clean finish pays more XP than finishing with the loan", XP.onCleanFinish > XP.onFinishWithLoan);
t("stepSpeed: throttle accelerates, coast slows, clamps at max", stepSpeed(0, 1, { maxSpeed: 32, accel: 22 }, 0.1) > 0 && stepSpeed(10, 0, { maxSpeed: 32, accel: 22 }, 0.1) < 10 && stepSpeed(31.9, 1, { maxSpeed: 32, accel: 22 }, 1) === 32);
t("fuelAfter burns more under throttle and never goes below zero", fuelAfter(50, true, 1) < fuelAfter(50, false, 1) && fuelAfter(0.1, true, 5) === 0);

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
