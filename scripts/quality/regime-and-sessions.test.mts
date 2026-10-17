// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/regime-and-sessions.test.mts
// (1) Session windows used by the sequence study are pairwise disjoint (the old windows overlapped by up to 4 hours).
// (2) The Fed-rate regime never uses a monthly-average FEDFUNDS observation before the month is over and published.
import { SEQUENCE_SESSION_WINDOWS } from "../../src/lib/agents/trading-agent/skills/session-sequence-analysis.ts";
import { classifyRegimeForDate, observationKnownDate } from "../../src/lib/agents/trading-agent/skills/macro-regime.ts";
import { makeT } from "../fixtures/fake-fetch.mts";

const { t, summary } = makeT();

// ---- (1) sessions
{
  const w = Object.entries(SEQUENCE_SESSION_WINDOWS);
  let overlap = false;
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) if (w[i][1].start < w[j][1].end && w[j][1].start < w[i][1].end) overlap = true;
  t("sequence-study session windows are pairwise disjoint", !overlap, JSON.stringify(SEQUENCE_SESSION_WINDOWS));
  t("each window is a valid UTC minute range within one day", w.every(([, x]) => x.start >= 0 && x.end <= 1440 && x.start < x.end));
  t("a prior session finishes before the follow-on session starts (Asian < London < New York)", SEQUENCE_SESSION_WINDOWS.asian.end <= SEQUENCE_SESSION_WINDOWS.london.start && SEQUENCE_SESSION_WINDOWS.london.end <= SEQUENCE_SESSION_WINDOWS.newYork.start);
}

// ---- (2) regime look-ahead (real FEDFUNDS monthly averages around the first 2024 cut, 2024-09-18)
{
  const obs = [["2024-01-01", 5.33], ["2024-02-01", 5.33], ["2024-03-01", 5.33], ["2024-04-01", 5.33], ["2024-05-01", 5.33], ["2024-06-01", 5.33], ["2024-07-01", 5.33], ["2024-08-01", 5.33], ["2024-09-01", 5.13], ["2024-10-01", 4.83], ["2024-11-01", 4.64], ["2024-12-01", 4.48]].map(([date, value]) => ({ date, value }));
  const timeline = { observations: obs };
  t("an observation dated 2024-09-01 is not known until after the month ends (2024-10-07)", observationKnownDate("2024-09-01") === "2024-10-07", observationKnownDate("2024-09-01"));
  t("leap-year February: known date is end of Feb plus the delay", observationKnownDate("2024-02-01") === "2024-03-07");
  t("year end rolls over: 2024-12-01 is known on 2025-01-07", observationKnownDate("2024-12-01") === "2025-01-07");
  for (const d of ["2024-09-03", "2024-09-17", "2024-09-18", "2024-10-06"]) {
    t(`regime on ${d} (before the September average is published) is not 'cutting'`, classifyRegimeForDate(d, timeline) !== "cutting", String(classifyRegimeForDate(d, timeline)));
  }
  t("regime on 2024-10-08 (September average now known: 5.13 vs 5.33 six months earlier) is 'cutting'", classifyRegimeForDate("2024-10-08", timeline) === "cutting", String(classifyRegimeForDate("2024-10-08", timeline)));
  t("never uses an observation whose month ends after the query date", obs.every((o) => {
    // pick a date one day before the observation becomes known: the regime must equal the one computed without it
    const known = observationKnownDate(o.date);
    const dayBefore = new Date(Date.parse(known) - 86400000).toISOString().slice(0, 10);
    const without = { observations: obs.filter((x) => x.date !== o.date && x.date < o.date) };
    const a = classifyRegimeForDate(dayBefore, timeline);
    const b = classifyRegimeForDate(dayBefore, { observations: obs.filter((x) => observationKnownDate(x.date) <= dayBefore) });
    return a === b && without.observations.length >= 0;
  }));
}

summary();
