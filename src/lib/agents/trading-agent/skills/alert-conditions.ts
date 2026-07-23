import { fetchQuote } from "@/lib/data/market-data";
import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { runOrbBacktest } from "./opening-range-breakout";
import { getOptionsChainSummary } from "./options-chain";
import { computeChainWideUnusualActivity, UNUSUAL_VOLUME_OI_RATIO } from "./options-flow-skew";
import { computeCoverageSpike, getGeopoliticalNews } from "./geopolitical-news";
import type { AlertEvaluation, AlertRule } from "../types";

// Same lookback the equity/forex/commodity watchlist scan already uses for
// these three signals — long enough for volume displacement's 20-day and
// mean reversion's 20-day rolling windows, momentum's 3-day window, with
// headroom for thin-history tickers.
const DAILY_BAR_LOOKBACK_DAYS = 60;
const ORB_LOOKBACK_MONTHS = 1;

/**
 * Dispatches one alert rule to the real signal computation it names, per the
 * reuse map: price_threshold -> fetchQuote, volume_displacement/momentum ->
 * scan-signals.ts, mean_reversion -> mean-reversion.ts, orb_breakout ->
 * runOrbBacktest's todaySnapshot, unusual_options ->
 * computeChainWideUnusualActivity (chain-wide, same-day only — see its own
 * doc comment), macro_news_spike -> computeCoverageSpike. No new signal math
 * lives here — this is purely the dispatch + plain-language message layer.
 */
export async function evaluateAlertRule(rule: AlertRule): Promise<AlertEvaluation> {
  const ticker = rule.ticker.trim().toUpperCase();

  switch (rule.conditionType) {
    case "price_threshold": {
      const targetPrice = Number(rule.params.targetPrice);
      const direction = rule.params.direction === "below" ? "below" : "above";
      if (!Number.isFinite(targetPrice)) {
        throw new Error(`price_threshold rule for ${ticker} is missing a numeric targetPrice param.`);
      }
      const quote = await fetchQuote(ticker);
      const triggered = direction === "above" ? quote.lastPrice >= targetPrice : quote.lastPrice <= targetPrice;
      const proximity = targetPrice !== 0 ? Math.abs(quote.lastPrice - targetPrice) / Math.abs(targetPrice) : null;
      return {
        triggered,
        message: `${ticker} is at $${quote.lastPrice.toFixed(2)} (target: ${direction} $${targetPrice.toFixed(2)}).`,
        proximity,
      };
    }

    case "volume_displacement": {
      const bars = await getDailyBars(ticker, DAILY_BAR_LOOKBACK_DAYS);
      const signal = computeVolumeDisplacement(bars);
      return {
        triggered: signal.triggered,
        message:
          signal.multiple !== null
            ? `${ticker} volume is ${signal.multiple.toFixed(2)}x its rolling average (threshold ${signal.threshold}x).`
            : `${ticker}: not enough volume history to evaluate yet.`,
        proximity: signal.multiple !== null ? signal.multiple / signal.threshold : null,
      };
    }

    case "momentum": {
      const bars = await getDailyBars(ticker, DAILY_BAR_LOOKBACK_DAYS);
      const signal = computeMomentum(bars);
      return {
        triggered: signal.triggered,
        message: `${ticker}: ${signal.daysGreenSoFar} consecutive green day(s) so far, volume ${
          signal.volumeIncreasing ? "increasing" : "not increasing"
        } each day.`,
        // Coarse proxy, per MomentumSignal's own doc comment — this signal has
        // no natural continuous "how close" value the way the other two do.
        proximity: signal.daysGreenSoFar,
      };
    }

    case "mean_reversion": {
      const bars = await getDailyBars(ticker, DAILY_BAR_LOOKBACK_DAYS);
      const signal = computeMeanReversion(bars);
      return {
        triggered: signal.triggered,
        message:
          signal.zScore !== null
            ? `${ticker} z-score is ${signal.zScore.toFixed(2)} (${signal.direction ?? "neutral"}, threshold ±${signal.threshold}).`
            : `${ticker}: not enough price history to evaluate yet.`,
        proximity: signal.zScore !== null ? Math.abs(signal.zScore) / signal.threshold : null,
      };
    }

    case "orb_breakout": {
      const requestedRange = rule.params.openingRangeMinutes;
      const openingRangeMinutes: 5 | 15 | 30 =
        requestedRange === 5 || requestedRange === 15 || requestedRange === 30 ? requestedRange : 15;
      const result = await runOrbBacktest(ticker, openingRangeMinutes, ORB_LOOKBACK_MONTHS);
      const direction = result.todaySnapshot?.breakoutDirection ?? null;
      const triggered = direction === "long" || direction === "short";
      return {
        triggered,
        message: triggered
          ? `${ticker} broke out ${direction} of its ${openingRangeMinutes}-min opening range today at ${
              result.todaySnapshot?.breakoutTimeClock ?? "an unknown time"
            }.`
          : `${ticker}: no opening-range breakout yet today.`,
        proximity: null, // binary condition, same as opening-range-breakout.ts's own todaySnapshot treats it
      };
    }

    case "unusual_options": {
      const chain = await getOptionsChainSummary(ticker);
      const activity = computeChainWideUnusualActivity(chain);
      return {
        triggered: activity.triggered,
        message:
          activity.maxRatio !== null
            ? `${ticker}: highest same-day volume/OI ratio is ${activity.maxRatio.toFixed(2)}x at the $${
                activity.strikePrice
              } ${activity.side} strike (threshold ${UNUSUAL_VOLUME_OI_RATIO}x).`
            : `${ticker}: no options volume/open-interest data available today.`,
        proximity: activity.maxRatio !== null ? activity.maxRatio / UNUSUAL_VOLUME_OI_RATIO : null,
      };
    }

    case "macro_news_spike": {
      const query = typeof rule.params.query === "string" && rule.params.query.trim() ? rule.params.query : ticker;
      const news = await getGeopoliticalNews(query);
      const spike = computeCoverageSpike(news.coverageVolume);
      return {
        triggered: spike.triggered,
        message:
          spike.multiple !== null
            ? `News coverage for "${query}" is ${spike.multiple.toFixed(1)}x its recent 7-day average.`
            : `Not enough coverage-volume history for "${query}" to evaluate yet.`,
        proximity: spike.multiple,
      };
    }

    default: {
      const exhaustiveCheck: never = rule.conditionType;
      throw new Error(`Unknown alert condition type: ${exhaustiveCheck}`);
    }
  }
}
