/**
 * Server-only aggregation for the /admin/analytics dashboard. Pulls raw rows
 * from the same Supabase project the rest of the analytics pipeline uses
 * (read-only) and aggregates in-process — current volume is low enough
 * (hundreds to low thousands of rows) that this is simpler and more
 * transparent than PostgREST aggregate views/RPCs. Revisit with real SQL
 * aggregation if row counts grow enough to make full-table pulls slow.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isAdminAnalyticsConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

interface EventRow {
  id: string;
  session_id: string;
  event_name: string;
  agent: string | null;
  tab: string | null;
  symbol: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface AlertSubscriptionRow {
  id: string;
  channel: string;
  active: boolean;
  created_at: string;
  session_id: string | null;
}

interface FeedbackRow {
  id: string;
  session_id: string;
  category: string;
  message: string;
  context_tab: string | null;
  experience_rating: number | null;
  comparable_products: string | null;
  source: string | null;
  created_at: string;
}

async function fetchAll<T>(table: string, params: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase request failed (${res.status}) for ${table}`);
  }
  return (await res.json()) as T[];
}

function countBy<T>(rows: T[], keyFn: (row: T) => string | null): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row) ?? "(none)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function metaBool(row: EventRow, key: string): boolean | null {
  const v = row.metadata?.[key];
  return typeof v === "boolean" ? v : null;
}
function metaStr(row: EventRow, key: string): string | null {
  const v = row.metadata?.[key];
  return typeof v === "string" ? v : null;
}
function metaNum(row: EventRow, key: string): number | null {
  const v = row.metadata?.[key];
  return typeof v === "number" ? v : null;
}

export interface AdminAnalyticsSummary {
  generatedAt: string;
  dataLimitations: string[];
  overview: {
    totalEvents: number;
    totalSessions: number;
    firstEvent: string | null;
    lastEvent: string | null;
    eventTypeBreakdown: { key: string; count: number }[];
  };
  navigation: {
    topTabs: { key: string; count: number }[];
    topAgents: { key: string; count: number }[];
  };
  tickerAnalysis: {
    totalAnalyzed: number;
    topSymbols: { key: string; count: number }[];
  };
  literacy: {
    placementCompletions: number;
    placementTierBreakdown: { key: string; count: number }[];
    totalAnswers: number;
    correctAnswers: number;
    accuracyRatePct: number | null;
    accuracyByMode: { mode: string; total: number; correct: number; accuracyRatePct: number | null }[];
    lowestAccuracyModules: { moduleId: string; total: number; correct: number; accuracyRatePct: number }[];
    quizRoundsCompleted: number;
    avgPointsPerRound: number | null;
  };
  assistant: {
    messagesSent: number;
    messagesFailed: number;
    sessionsUsingAssistant: number;
    avgQuestionLength: number | null;
    avgReplyLength: number | null;
    topToolsUsed: { key: string; count: number }[];
  };
  alerts: {
    totalSubscriptions: number;
    channelBreakdown: { key: string; count: number }[];
    activeCount: number;
    withPriorSessionActivityCount: number;
    withPriorSessionActivityRatePct: number | null;
  };
  acquisition: {
    sessionStarts: number;
    topUtmSources: { key: string; count: number }[];
    topUtmMediums: { key: string; count: number }[];
    topUtmCampaigns: { key: string; count: number }[];
    topReferrers: { key: string; count: number }[];
    directCount: number;
  };
  engagement: {
    avgEventsPerSession: number | null;
    medianEventsPerSession: number | null;
    maxEventsInASession: number | null;
    avgSessionSpanMinutes: number | null;
  };
  trading: {
    backtestsRun: number;
    backtestPassRatePct: number | null;
    calendarEffectsRuns: number;
    calendarEffectsPassRatePct: number | null;
    orbWatchlistScans: number;
    orbBacktestsRun: number;
    orbBacktestPassRatePct: number | null;
    pmVolumeChecks: number;
    pmVolumeAnomalyRatePct: number | null;
    pmVolumeScans: number;
    optionsCalcRuns: number;
    pegBacktestsRun: number;
    pegBacktestPassRatePct: number | null;
    alertSubscriptions: number;
    watchlistAdds: number;
    watchlistRemoves: number;
    topSymbolsBacktested: { key: string; count: number }[];
  };
  research: {
    watchlistRemoves: number;
    screenerRuns: number;
    sectorStockAnalysisRuns: number;
    sectorStockForecastRatePct: number | null;
  };
  portfolio: {
    scenarioSimulationsRun: number;
    rebalancingComputations: number;
    hedgeCalculatorUses: number;
    correlationFinderRuns: number;
    traditionalCandidatesAdded: number;
    mptAnalysesRun: number;
  };
  systemHealth: {
    totalApiErrors: number;
    topFailingEndpoints: { key: string; count: number }[];
  };
  feedback: {
    totalSubmissions: number;
    avgExperienceRating: number | null;
    ratingDistribution: { key: string; count: number }[];
    sourceBreakdown: { key: string; count: number }[];
    recentComparableProducts: { text: string; createdAt: string }[];
    recentSubmissions: { category: string; message: string; rating: number | null; source: string; contextTab: string | null; createdAt: string }[];
  };
}

export async function getAdminAnalyticsSummary(): Promise<AdminAnalyticsSummary> {
  const [events, subscriptions, feedbackRows] = await Promise.all([
    fetchAll<EventRow>("events", "select=*&order=created_at.asc&limit=10000"),
    fetchAll<AlertSubscriptionRow>("alert_subscriptions", "select=id,channel,active,created_at,session_id&limit=10000"),
    fetchAll<FeedbackRow>("feedback", "select=*&order=created_at.desc&limit=500"),
  ]);

  const dataLimitations: string[] = [];
  if (events.length >= 10000) dataLimitations.push("Events capped at 10,000 rows — totals may undercount beyond that.");

  const sessionIds = new Set(events.map((e) => e.session_id));
  const eventTypeBreakdown = countBy(events, (e) => e.event_name);

  const tabViews = events.filter((e) => e.event_name === "tab_view");
  const tickerEvents = events.filter((e) => e.event_name === "ticker_analyzed");

  const literacyAnswers = events.filter((e) => e.event_name === "literacy_answer");
  const literacyRounds = events.filter((e) => e.event_name === "literacy_quiz_round_completed");
  const placements = events.filter((e) => e.event_name === "literacy_placement_completed");

  const correctAnswers = literacyAnswers.filter((e) => metaBool(e, "correct") === true);
  const modeGroups = new Map<string, { total: number; correct: number }>();
  for (const e of literacyAnswers) {
    const mode = metaStr(e, "mode") ?? "(unknown)";
    const g = modeGroups.get(mode) ?? { total: 0, correct: 0 };
    g.total += 1;
    if (metaBool(e, "correct") === true) g.correct += 1;
    modeGroups.set(mode, g);
  }
  const moduleGroups = new Map<string, { total: number; correct: number }>();
  for (const e of literacyAnswers) {
    const moduleId = metaStr(e, "moduleId");
    if (!moduleId) continue;
    const g = moduleGroups.get(moduleId) ?? { total: 0, correct: 0 };
    g.total += 1;
    if (metaBool(e, "correct") === true) g.correct += 1;
    moduleGroups.set(moduleId, g);
  }
  const lowestAccuracyModules = [...moduleGroups.entries()]
    .filter(([, g]) => g.total >= 2)
    .map(([moduleId, g]) => ({ moduleId, total: g.total, correct: g.correct, accuracyRatePct: Number(((g.correct / g.total) * 100).toFixed(1)) }))
    .sort((a, b) => a.accuracyRatePct - b.accuracyRatePct)
    .slice(0, 10);

  const roundPoints = literacyRounds.map((e) => metaNum(e, "pointsScored")).filter((v): v is number => v !== null);

  const assistantSent = events.filter((e) => e.event_name === "assistant_message_sent");
  const assistantFailed = events.filter((e) => e.event_name === "assistant_message_failed");
  const assistantSessionIds = new Set(assistantSent.map((e) => e.session_id));
  const questionLengths = assistantSent.map((e) => metaNum(e, "questionLength")).filter((v): v is number => v !== null);
  const replyLengths = assistantSent.map((e) => metaNum(e, "replyLength")).filter((v): v is number => v !== null);
  const toolCounts = new Map<string, number>();
  for (const e of assistantSent) {
    const tools = e.metadata?.["toolsUsed"];
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (typeof t === "string") toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
      }
    }
  }
  const topToolsUsed = [...toolCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

  const sessionStarts = events.filter((e) => e.event_name === "session_start");
  const utmSourceCounts = countBy(sessionStarts.filter((e) => metaStr(e, "utmSource")), (e) => metaStr(e, "utmSource"));
  const utmMediumCounts = countBy(sessionStarts.filter((e) => metaStr(e, "utmMedium")), (e) => metaStr(e, "utmMedium"));
  const utmCampaignCounts = countBy(sessionStarts.filter((e) => metaStr(e, "utmCampaign")), (e) => metaStr(e, "utmCampaign"));
  const referrerCounts = countBy(sessionStarts.filter((e) => metaStr(e, "referrer")), (e) => metaStr(e, "referrer"));
  const directCount = sessionStarts.filter((e) => !metaStr(e, "utmSource") && !metaStr(e, "referrer")).length;

  const eventsPerSession = new Map<string, number>();
  const sessionSpanMs = new Map<string, { min: number; max: number }>();
  for (const e of events) {
    eventsPerSession.set(e.session_id, (eventsPerSession.get(e.session_id) ?? 0) + 1);
    const t = Date.parse(e.created_at);
    const span = sessionSpanMs.get(e.session_id);
    if (!span) sessionSpanMs.set(e.session_id, { min: t, max: t });
    else {
      span.min = Math.min(span.min, t);
      span.max = Math.max(span.max, t);
    }
  }
  const perSessionCounts = [...eventsPerSession.values()].sort((a, b) => a - b);
  const spans = [...sessionSpanMs.values()].map((s) => (s.max - s.min) / 60000);

  const subscriptionsWithSession = subscriptions.filter((s) => s.session_id && sessionIds.has(s.session_id));

  const passRatePct = (rows: EventRow[]): number | null =>
    rows.length > 0 ? Number(((rows.filter((e) => metaBool(e, "passesAllThreeBars") === true).length / rows.length) * 100).toFixed(1)) : null;

  const backtests = events.filter((e) => e.event_name === "backtest_run");
  const calendarEffects = events.filter((e) => e.event_name === "calendar_effects_run");
  const orbWatchlistScans = events.filter((e) => e.event_name === "orb_watchlist_scan");
  const orbBacktests = events.filter((e) => e.event_name === "orb_backtest_run");
  const pmVolumeChecks = events.filter((e) => e.event_name === "pm_volume_check");
  const pmVolumeScans = events.filter((e) => e.event_name === "pm_volume_scan");
  const optionsCalcRuns = events.filter((e) => e.event_name === "options_calc_run");
  const pegBacktests = events.filter((e) => e.event_name === "peg_backtest_run");
  const alertSubscribedEvents = events.filter((e) => e.event_name === "alert_subscribed");
  const watchlistAdds = events.filter((e) => e.event_name === "watchlist_entry_added");
  const watchlistRemoves = events.filter((e) => e.event_name === "watchlist_entry_removed");

  const researchWatchlistRemoves = events.filter((e) => e.event_name === "research_watchlist_removed");
  const screenerRuns = events.filter((e) => e.event_name === "screener_run");
  const sectorStockRuns = events.filter((e) => e.event_name === "sector_stock_analysis_run");

  const scenarioSims = events.filter((e) => e.event_name === "scenario_simulation_run");
  const rebalancing = events.filter((e) => e.event_name === "rebalancing_computed");
  const hedgeCalc = events.filter((e) => e.event_name === "hedge_calc_used");
  const correlationFinder = events.filter((e) => e.event_name === "correlation_finder_run");
  const traditionalAdds = events.filter((e) => e.event_name === "traditional_candidate_added");
  const mptRuns = events.filter((e) => e.event_name === "mpt_analysis_run");

  const apiErrors = events.filter((e) => e.event_name === "api_error");

  const ratedFeedback = feedbackRows.filter((f): f is FeedbackRow & { experience_rating: number } => f.experience_rating !== null);

  return {
    generatedAt: new Date().toISOString(),
    dataLimitations,
    overview: {
      totalEvents: events.length,
      totalSessions: sessionIds.size,
      firstEvent: events[0]?.created_at ?? null,
      lastEvent: events[events.length - 1]?.created_at ?? null,
      eventTypeBreakdown,
    },
    navigation: {
      topTabs: countBy(tabViews, (e) => e.tab),
      topAgents: countBy(tabViews, (e) => e.agent),
    },
    tickerAnalysis: {
      totalAnalyzed: tickerEvents.length,
      topSymbols: countBy(tickerEvents, (e) => e.symbol),
    },
    literacy: {
      placementCompletions: placements.length,
      placementTierBreakdown: countBy(placements, (e) => metaStr(e, "tier")),
      totalAnswers: literacyAnswers.length,
      correctAnswers: correctAnswers.length,
      accuracyRatePct: literacyAnswers.length > 0 ? Number(((correctAnswers.length / literacyAnswers.length) * 100).toFixed(1)) : null,
      accuracyByMode: [...modeGroups.entries()].map(([mode, g]) => ({
        mode,
        total: g.total,
        correct: g.correct,
        accuracyRatePct: g.total > 0 ? Number(((g.correct / g.total) * 100).toFixed(1)) : null,
      })),
      lowestAccuracyModules,
      quizRoundsCompleted: literacyRounds.length,
      avgPointsPerRound: roundPoints.length > 0 ? Number((roundPoints.reduce((a, b) => a + b, 0) / roundPoints.length).toFixed(1)) : null,
    },
    assistant: {
      messagesSent: assistantSent.length,
      messagesFailed: assistantFailed.length,
      sessionsUsingAssistant: assistantSessionIds.size,
      avgQuestionLength: questionLengths.length > 0 ? Number((questionLengths.reduce((a, b) => a + b, 0) / questionLengths.length).toFixed(0)) : null,
      avgReplyLength: replyLengths.length > 0 ? Number((replyLengths.reduce((a, b) => a + b, 0) / replyLengths.length).toFixed(0)) : null,
      topToolsUsed,
    },
    alerts: {
      totalSubscriptions: subscriptions.length,
      channelBreakdown: countBy(subscriptions, (s) => s.channel),
      activeCount: subscriptions.filter((s) => s.active).length,
      withPriorSessionActivityCount: subscriptionsWithSession.length,
      withPriorSessionActivityRatePct: subscriptions.length > 0 ? Number(((subscriptionsWithSession.length / subscriptions.length) * 100).toFixed(1)) : null,
    },
    acquisition: {
      sessionStarts: sessionStarts.length,
      topUtmSources: utmSourceCounts,
      topUtmMediums: utmMediumCounts,
      topUtmCampaigns: utmCampaignCounts,
      topReferrers: referrerCounts,
      directCount,
    },
    engagement: {
      avgEventsPerSession: perSessionCounts.length > 0 ? Number((perSessionCounts.reduce((a, b) => a + b, 0) / perSessionCounts.length).toFixed(1)) : null,
      medianEventsPerSession:
        perSessionCounts.length > 0
          ? perSessionCounts.length % 2 === 0
            ? (perSessionCounts[perSessionCounts.length / 2 - 1] + perSessionCounts[perSessionCounts.length / 2]) / 2
            : perSessionCounts[(perSessionCounts.length - 1) / 2]
          : null,
      maxEventsInASession: perSessionCounts.length > 0 ? perSessionCounts[perSessionCounts.length - 1] : null,
      avgSessionSpanMinutes: spans.length > 0 ? Number((spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(1)) : null,
    },
    trading: {
      backtestsRun: backtests.length,
      backtestPassRatePct: passRatePct(backtests),
      calendarEffectsRuns: calendarEffects.length,
      calendarEffectsPassRatePct: passRatePct(calendarEffects),
      orbWatchlistScans: orbWatchlistScans.length,
      orbBacktestsRun: orbBacktests.length,
      orbBacktestPassRatePct: passRatePct(orbBacktests),
      pmVolumeChecks: pmVolumeChecks.length,
      pmVolumeAnomalyRatePct:
        pmVolumeChecks.length > 0
          ? Number(((pmVolumeChecks.filter((e) => metaBool(e, "isAnomaly") === true).length / pmVolumeChecks.length) * 100).toFixed(1))
          : null,
      pmVolumeScans: pmVolumeScans.length,
      optionsCalcRuns: optionsCalcRuns.length,
      pegBacktestsRun: pegBacktests.length,
      pegBacktestPassRatePct: passRatePct(pegBacktests),
      alertSubscriptions: alertSubscribedEvents.length,
      watchlistAdds: watchlistAdds.length,
      watchlistRemoves: watchlistRemoves.length,
      topSymbolsBacktested: countBy(backtests, (e) => e.symbol),
    },
    research: {
      watchlistRemoves: researchWatchlistRemoves.length,
      screenerRuns: screenerRuns.length,
      sectorStockAnalysisRuns: sectorStockRuns.length,
      sectorStockForecastRatePct:
        sectorStockRuns.length > 0
          ? Number(((sectorStockRuns.filter((e) => metaBool(e, "forecast") === true).length / sectorStockRuns.length) * 100).toFixed(1))
          : null,
    },
    portfolio: {
      scenarioSimulationsRun: scenarioSims.length,
      rebalancingComputations: rebalancing.length,
      hedgeCalculatorUses: hedgeCalc.length,
      correlationFinderRuns: correlationFinder.length,
      traditionalCandidatesAdded: traditionalAdds.length,
      mptAnalysesRun: mptRuns.length,
    },
    systemHealth: {
      totalApiErrors: apiErrors.length,
      topFailingEndpoints: countBy(apiErrors, (e) => metaStr(e, "endpoint")),
    },
    feedback: {
      totalSubmissions: feedbackRows.length,
      avgExperienceRating:
        ratedFeedback.length > 0 ? Number((ratedFeedback.reduce((a, f) => a + f.experience_rating, 0) / ratedFeedback.length).toFixed(2)) : null,
      ratingDistribution: countBy(ratedFeedback, (f) => String(f.experience_rating)),
      sourceBreakdown: countBy(feedbackRows, (f) => f.source ?? "assistant_chat"),
      recentComparableProducts: feedbackRows
        .filter((f) => f.comparable_products && f.comparable_products.trim().length > 0)
        .slice(0, 30)
        .map((f) => ({ text: f.comparable_products as string, createdAt: f.created_at })),
      recentSubmissions: feedbackRows.slice(0, 30).map((f) => ({
        category: f.category,
        message: f.message,
        rating: f.experience_rating,
        source: f.source ?? "assistant_chat",
        contextTab: f.context_tab,
        createdAt: f.created_at,
      })),
    },
  };
}
