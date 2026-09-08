import { fetchRecentFilings } from "@/lib/data/sec-edgar";
import { fetchCashFlowStatement } from "@/lib/data/fmp";
import { getDailyBars } from "./daily-bars";
import { linearRegression } from "../stats";
import { returnsByDate } from "./buyback-gld-event-study";
import { bootstrapCi } from "./stats-tests";
import type { CorporateBuybackDisclosureRow, CorporateBuybackOfferingResult, CorporateOfferingEventRow, MarketModelFit } from "../types";

const LOOKBACK_DAYS = 900;
// A broad, liquid equity-market benchmark — the natural analogue of
// buyback-gld-event-study.ts's UUP (dollar-strength) benchmark, but for
// individual equities rather than a dollar-sensitive asset like GLD.
const MARKET_MODEL_BENCHMARK = "SPY";
// SEC EDGAR form types for an actual registered secondary/follow-on equity
// offering — the real, filed dilution event, not an inferred one.
const OFFERING_FORMS = ["424B1", "424B2", "424B3", "424B4", "424B5", "S-1", "S-3"];

/**
 * Real event study on two distinct corporate actions, deliberately kept
 * simpler than buyback-gld-event-study.ts's full apparatus (no single-pass
 * dummy-variable regression, no beta-drift check) — both event types here
 * are far sparser (SEC caps recent filings returned; FMP's free tier caps
 * financial-statement history at 5 periods), so the extra machinery would
 * imply more rigor than the sample size can support. See dataLimitations for
 * every real constraint.
 *
 * 1. Offerings: real SEC EDGAR filing dates for registered securities
 *    offerings (424B-series, S-1, S-3) — a real, filed event, not one
 *    inferred from share-count deltas. Important caveat confirmed against
 *    real data: these forms register equity OR debt, and this tool can't
 *    tell which from the form type alone (see dataLimitations).
 * 2. Buyback disclosures: FMP's real quarterly cash-flow-statement
 *    commonStockRepurchased figure, dated to that filing's real filing date
 *    — the closest real, public proxy for "buyback activity became known,"
 *    since exact daily repurchase amounts aren't public.
 */
export async function runCorporateBuybackOfferingStudy(ticker: string): Promise<CorporateBuybackOfferingResult> {
  const dataLimitations: string[] = [];

  const [filings, targetBars, benchmarkBars, cashFlows] = await Promise.all([
    fetchRecentFilings(ticker, OFFERING_FORMS).catch((err) => {
      dataLimitations.push(`Could not fetch SEC EDGAR filings for ${ticker}: ${err instanceof Error ? err.message : "unknown error"}.`);
      return [];
    }),
    getDailyBars(ticker, LOOKBACK_DAYS),
    getDailyBars(MARKET_MODEL_BENCHMARK, LOOKBACK_DAYS),
    fetchCashFlowStatement(ticker, 5, "quarter").catch((err) => {
      dataLimitations.push(`Could not fetch quarterly cash-flow statements for ${ticker}: ${err instanceof Error ? err.message : "unknown error"}.`);
      return [];
    }),
  ]);

  dataLimitations.push(
    "SEC EDGAR's submissions endpoint returns a bounded window of recent filings — this scan is capped to the 10 most recent matching filings, so a company with a long offering history further back won't show its full record here."
  );
  dataLimitations.push(
    "424B-series/S-1/S-3 filings register EITHER equity OR debt securities — the form type alone doesn't say which, and this tool doesn't parse the filing itself to tell them apart. A company that regularly issues corporate bonds (e.g. Apple) will show 424B2 filings here that are real bond offerings, not equity dilution. Click through to the filing before treating any event here as a real dilution event."
  );
  dataLimitations.push(
    "FMP's free tier caps financial-statement history to 5 periods regardless of what's requested — with quarterly data that's roughly the last year, too few for a reliable regression, so buyback disclosures are shown as directional per-event data only (no fitted line)."
  );

  const dateIndex = new Map(targetBars.map((b, i) => [b.dateKey, i]));
  const benchmarkReturns = returnsByDate(benchmarkBars);
  const targetReturns = returnsByDate(targetBars);

  // Market model fit on the full non-filing-day sample (offerings only —
  // buyback disclosures aren't excluded since they're too sparse to matter).
  const offeringDateKeys = new Set(filings.map((f) => f.filingDate));
  const alignedBenchmark: number[] = [];
  const alignedTarget: number[] = [];
  for (const bar of benchmarkBars) {
    const bReturn = benchmarkReturns.get(bar.dateKey);
    const tReturn = targetReturns.get(bar.dateKey);
    if (bReturn === undefined || tReturn === undefined || offeringDateKeys.has(bar.dateKey)) continue;
    alignedBenchmark.push(bReturn);
    alignedTarget.push(tReturn);
  }
  const marketModelReg = linearRegression(alignedBenchmark, alignedTarget);
  const marketModel: MarketModelFit | null = marketModelReg
    ? { benchmarkTicker: MARKET_MODEL_BENCHMARK, beta: marketModelReg.slope, alpha: marketModelReg.intercept, rSquared: marketModelReg.rSquared, n: marketModelReg.n }
    : null;

  const offeringEvents: CorporateOfferingEventRow[] = [];
  let skippedOfferingsNoBarData = 0;
  for (const filing of filings) {
    const i = dateIndex.get(filing.filingDate);
    if (i === undefined || i === 0 || i >= targetBars.length - 1) {
      skippedOfferingsNoBarData++;
      continue;
    }
    const priorClose = targetBars[i - 1].close;
    const dayClose = targetBars[i].close;
    const nextClose = targetBars[i + 1].close;
    if (priorClose <= 0 || dayClose <= 0) {
      skippedOfferingsNoBarData++;
      continue;
    }
    const day0ReturnPct = ((dayClose - priorClose) / priorClose) * 100;
    const day1ReturnPct = ((nextClose - dayClose) / dayClose) * 100;
    const bench0 = benchmarkReturns.get(targetBars[i].dateKey);
    const bench1 = benchmarkReturns.get(targetBars[i + 1].dateKey);
    const day0AbnormalReturnPct = marketModel && bench0 !== undefined ? day0ReturnPct - (marketModel.alpha + marketModel.beta * bench0) : null;
    const day1AbnormalReturnPct = marketModel && bench1 !== undefined ? day1ReturnPct - (marketModel.alpha + marketModel.beta * bench1) : null;
    offeringEvents.push({
      filingDate: filing.filingDate,
      formType: filing.form,
      url: filing.url,
      day0ReturnPct,
      day1ReturnPct,
      day0AbnormalReturnPct,
      day1AbnormalReturnPct,
    });
  }
  if (skippedOfferingsNoBarData > 0) {
    dataLimitations.push(`${skippedOfferingsNoBarData} offering filing(s) skipped — no matching ${ticker} trading-day bar available (edge of history or data gap).`);
  }
  if (filings.length === 0) {
    dataLimitations.push(`No 424B*/S-1/S-3 filings found for ${ticker} in SEC EDGAR's recent-filings window — either no recent registered offering, or not a US-listed filer.`);
  }

  // SEC filings don't disclose a structured, immediately parseable dollar
  // size for the offering, so there's no real size regressor available here
  // (unlike the Treasury buyback tool's real dollar-amount-accepted
  // regressor) — instead, this reports a bootstrap 95% CI on the mean
  // reaction across all real matched events, which only claims what it can
  // support: whether offerings as a group show a real average reaction.
  const offeringDay0Stats = offeringEvents.length > 0 ? bootstrapCi(offeringEvents.map((e) => e.day0ReturnPct)) : null;
  const offeringDay1Stats = offeringEvents.length > 0 ? bootstrapCi(offeringEvents.map((e) => e.day1ReturnPct)) : null;
  const abnormalOfferingEvents = offeringEvents.filter((e) => e.day0AbnormalReturnPct !== null && e.day1AbnormalReturnPct !== null);
  const offeringDay0AbnormalStats =
    abnormalOfferingEvents.length > 0 ? bootstrapCi(abnormalOfferingEvents.map((e) => e.day0AbnormalReturnPct as number)) : null;
  const offeringDay1AbnormalStats =
    abnormalOfferingEvents.length > 0 ? bootstrapCi(abnormalOfferingEvents.map((e) => e.day1AbnormalReturnPct as number)) : null;

  const buybackDisclosures: CorporateBuybackDisclosureRow[] = cashFlows
    .filter((cf) => cf.commonStockRepurchased !== undefined && cf.commonStockRepurchased !== 0)
    .map((cf) => {
      const filingDate = cf.fillingDate ?? cf.date;
      const i = dateIndex.get(filingDate);
      const day0ReturnPct =
        i !== undefined && i > 0 && targetBars[i - 1].close > 0 ? ((targetBars[i].close - targetBars[i - 1].close) / targetBars[i - 1].close) * 100 : null;
      return {
        periodEndDate: cf.date,
        filingDate,
        repurchasedUsd: Math.abs(cf.commonStockRepurchased ?? 0),
        day0ReturnPct,
      };
    })
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));

  if (cashFlows.length > 0 && cashFlows.every((cf) => cf.fillingDate === undefined)) {
    dataLimitations.push(
      `FMP's cash-flow-statement response for ${ticker} didn't include a distinct filing date — falling back to each period's end date, which is earlier than the real public disclosure date and will understate any filing-day price reaction.`
    );
  }

  return {
    ticker,
    benchmarkTicker: MARKET_MODEL_BENCHMARK,
    marketModel,
    offeringEvents,
    offeringDay0Stats,
    offeringDay1Stats,
    offeringDay0AbnormalStats,
    offeringDay1AbnormalStats,
    buybackDisclosures,
    dataLimitations,
  };
}
