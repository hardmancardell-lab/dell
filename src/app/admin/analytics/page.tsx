import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminAnalyticsSummary, isAdminAnalyticsConfigured } from "@/lib/analytics/admin-queries";
import type { AdminAnalyticsSummary } from "@/lib/analytics/admin-queries";

// Hidden, cookie-gated internal dashboard — not linked from anywhere in the
// app's own navigation. Sign in once at /admin/login (POST, never a URL
// param) to get an httpOnly session cookie; this page only ever reads that
// cookie, never a ?secret= query string, so the password can't end up
// sitting in browser history, a shared link, or a server access log.
// Returns a plain 404 on any missing/invalid session rather than an
// "unauthorized" page, so it doesn't advertise its own existence to crawlers.

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-zinc-50">{value}</div>
      {sub && <div className="text-xs text-zinc-400 mt-1">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, rows, valueLabel = "Count" }: { title: string; rows: { key: string; count: number }[]; valueLabel?: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm font-medium mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-zinc-400">No data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-400">
              <th className="pb-2 font-normal">Key</th>
              <th className="pb-2 font-normal text-right">{valueLabel}</th>
              <th className="pb-2 font-normal text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.key} className="border-t border-zinc-800">
                <td className="py-1.5 pr-2 truncate max-w-[240px]">{r.key}</td>
                <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-400">{total > 0 ? ((r.count / total) * 100).toFixed(1) : "0.0"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold mb-3 text-zinc-50">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function Dashboard({ data }: { data: AdminAnalyticsSummary }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="flex gap-3">
          <a href="/admin/clients" className="text-xs text-teal-400 hover:underline">→ Client Dashboards</a>
          <a href="/admin/book-risk" className="text-xs text-teal-400 hover:underline">→ Book Risk</a>
        </div>
        <h1 className="text-2xl font-bold text-zinc-50 mt-1">Usage Analytics</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Generated {fmtDate(data.generatedAt)}. Window: {fmtDate(data.overview.firstEvent)} → {fmtDate(data.overview.lastEvent)}.
        </p>
        {data.dataLimitations.length > 0 && (
          <ul className="mt-2 text-xs text-amber-400 list-disc list-inside">
            {data.dataLimitations.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>

      <Section title="Overview">
        <StatCard label="Total Events" value={data.overview.totalEvents} />
        <StatCard label="Unique Sessions" value={data.overview.totalSessions} />
        <StatCard
          label="Avg Events / Session"
          value={data.engagement.avgEventsPerSession ?? "—"}
          sub={`Median ${data.engagement.medianEventsPerSession ?? "—"}, max ${data.engagement.maxEventsInASession ?? "—"}`}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <BreakdownTable title="Events by Type" rows={data.overview.eventTypeBreakdown} />
        </div>
      </Section>

      <Section title="Navigation">
        <BreakdownTable title="Top Tabs Viewed" rows={data.navigation.topTabs} />
        <BreakdownTable title="Top Agents" rows={data.navigation.topAgents} />
        <StatCard label="Avg Session Span" value={data.engagement.avgSessionSpanMinutes !== null ? `${data.engagement.avgSessionSpanMinutes} min` : "—"} sub="min → max event timestamp per session" />
      </Section>

      <Section title="Ticker Analysis">
        <StatCard label="Tickers Analyzed (total)" value={data.tickerAnalysis.totalAnalyzed} />
        <div className="sm:col-span-2 lg:col-span-2">
          <BreakdownTable title="Most-Analyzed Symbols" rows={data.tickerAnalysis.topSymbols} />
        </div>
      </Section>

      <Section title="Financial Literacy">
        <StatCard label="Placement Quizzes Completed" value={data.literacy.placementCompletions} />
        <StatCard
          label="Question Answers"
          value={data.literacy.totalAnswers}
          sub={data.literacy.accuracyRatePct !== null ? `${data.literacy.accuracyRatePct}% correct overall` : "no data yet"}
        />
        <StatCard label="Quiz Mode Rounds Completed" value={data.literacy.quizRoundsCompleted} sub={data.literacy.avgPointsPerRound !== null ? `avg ${data.literacy.avgPointsPerRound} pts/round` : undefined} />
        <BreakdownTable title="Placement Tier Breakdown" rows={data.literacy.placementTierBreakdown} />
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="text-sm font-medium mb-3">Accuracy by Mode</div>
          {data.literacy.accuracyByMode.length === 0 ? (
            <div className="text-sm text-zinc-400">No data yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-normal">Mode</th>
                  <th className="pb-2 font-normal text-right">Answers</th>
                  <th className="pb-2 font-normal text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.literacy.accuracyByMode.map((m) => (
                  <tr key={m.mode} className="border-t border-zinc-800">
                    <td className="py-1.5">{m.mode}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.total}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.accuracyRatePct !== null ? `${m.accuracyRatePct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="text-sm font-medium mb-3">Lowest-Accuracy Modules (n≥2)</div>
          {data.literacy.lowestAccuracyModules.length === 0 ? (
            <div className="text-sm text-zinc-400">Not enough data yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-normal">Module</th>
                  <th className="pb-2 font-normal text-right">Answers</th>
                  <th className="pb-2 font-normal text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.literacy.lowestAccuracyModules.map((m) => (
                  <tr key={m.moduleId} className="border-t border-zinc-800">
                    <td className="py-1.5 truncate max-w-[200px]">{m.moduleId}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.total}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.accuracyRatePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <Section title="Assistant Chat">
        <StatCard label="Messages Sent" value={data.assistant.messagesSent} sub={`${data.assistant.messagesFailed} failed`} />
        <StatCard label="Sessions That Used Assistant" value={data.assistant.sessionsUsingAssistant} />
        <StatCard
          label="Avg Question / Reply Length"
          value={data.assistant.avgQuestionLength !== null ? `${data.assistant.avgQuestionLength} / ${data.assistant.avgReplyLength} chars` : "—"}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <BreakdownTable title="Top Tools Used" rows={data.assistant.topToolsUsed} />
        </div>
      </Section>

      <Section title="Trading Agent">
        <StatCard label="Backtests Run" value={data.trading.backtestsRun} sub={data.trading.backtestPassRatePct !== null ? `${data.trading.backtestPassRatePct}% passed all 3 statistical bars` : undefined} />
        <StatCard label="Calendar Effects Runs" value={data.trading.calendarEffectsRuns} sub={data.trading.calendarEffectsPassRatePct !== null ? `${data.trading.calendarEffectsPassRatePct}% passed all 3 bars` : undefined} />
        <StatCard label="ORB Backtests Run" value={data.trading.orbBacktestsRun} sub={data.trading.orbBacktestPassRatePct !== null ? `${data.trading.orbBacktestPassRatePct}% passed all 3 bars` : undefined} />
        <StatCard label="ORB Watchlist Scans" value={data.trading.orbWatchlistScans} />
        <StatCard label="PM-Volume Checks" value={data.trading.pmVolumeChecks} sub={data.trading.pmVolumeAnomalyRatePct !== null ? `${data.trading.pmVolumeAnomalyRatePct}% flagged anomaly` : undefined} />
        <StatCard label="PM-Volume Sector/Market Scans" value={data.trading.pmVolumeScans} />
        <StatCard label="Options Calculator Runs" value={data.trading.optionsCalcRuns} />
        <StatCard label="Currency Peg Backtests" value={data.trading.pegBacktestsRun} sub={data.trading.pegBacktestPassRatePct !== null ? `${data.trading.pegBacktestPassRatePct}% passed all 3 bars` : undefined} />
        <StatCard label="Watchlist Adds / Removes" value={`${data.trading.watchlistAdds} / ${data.trading.watchlistRemoves}`} />
        <div className="sm:col-span-2 lg:col-span-3">
          <BreakdownTable title="Most-Backtested Symbols" rows={data.trading.topSymbolsBacktested} />
        </div>
      </Section>

      <Section title="Research Agent">
        <StatCard label="Screener Runs" value={data.research.screenerRuns} />
        <StatCard label="Sector Stock Analysis Runs" value={data.research.sectorStockAnalysisRuns} sub={data.research.sectorStockForecastRatePct !== null ? `${data.research.sectorStockForecastRatePct}% with AI forecast on` : undefined} />
        <StatCard label="Watchlist Removes" value={data.research.watchlistRemoves} />
      </Section>

      <Section title="Portfolio Tracker">
        <StatCard label="Scenario Simulations Run" value={data.portfolio.scenarioSimulationsRun} />
        <StatCard label="Modern Portfolio Theory Runs" value={data.portfolio.mptAnalysesRun} />
        <StatCard label="Correlation Finder Runs" value={data.portfolio.correlationFinderRuns} />
        <StatCard label="Rebalancing Target Edits" value={data.portfolio.rebalancingComputations} />
        <StatCard label="Hedge Calculator Uses" value={data.portfolio.hedgeCalculatorUses} />
        <StatCard label="Traditional Candidates Added" value={data.portfolio.traditionalCandidatesAdded} />
      </Section>

      <Section title="System Health">
        <StatCard label="Total API Errors" value={data.systemHealth.totalApiErrors} sub="client-visible fetch failures across every agent" />
        <div className="sm:col-span-2 lg:col-span-2">
          <BreakdownTable title="Top Failing Endpoints" rows={data.systemHealth.topFailingEndpoints} />
        </div>
      </Section>

      <Section title="Alerts Conversions">
        <StatCard label="Total Subscriptions" value={data.alerts.totalSubscriptions} sub={`${data.alerts.activeCount} active`} />
        <StatCard
          label="Linked to Prior Session Activity"
          value={data.alerts.withPriorSessionActivityCount}
          sub={data.alerts.withPriorSessionActivityRatePct !== null ? `${data.alerts.withPriorSessionActivityRatePct}% of signups` : undefined}
        />
        <BreakdownTable title="Channel Breakdown" rows={data.alerts.channelBreakdown} />
      </Section>

      <Section title="Acquisition (First-Touch)">
        <StatCard label="New Sessions Captured" value={data.acquisition.sessionStarts} sub={`${data.acquisition.directCount} direct/unknown`} />
        <BreakdownTable title="Top UTM Sources" rows={data.acquisition.topUtmSources} />
        <BreakdownTable title="Top UTM Mediums" rows={data.acquisition.topUtmMediums} />
        <BreakdownTable title="Top UTM Campaigns" rows={data.acquisition.topUtmCampaigns} />
        <div className="sm:col-span-2 lg:col-span-2">
          <BreakdownTable title="Top Referrers" rows={data.acquisition.topReferrers} />
        </div>
      </Section>

      <Section title="Beta Feedback">
        <StatCard label="Total Submissions" value={data.feedback.totalSubmissions} />
        <StatCard label="Avg Experience Rating" value={data.feedback.avgExperienceRating ?? "—"} sub="out of 5" />
        <BreakdownTable title="Rating Distribution" rows={data.feedback.ratingDistribution} />
        <BreakdownTable title="Source Breakdown" rows={data.feedback.sourceBreakdown} />
        <div className="sm:col-span-2 lg:col-span-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm font-medium mb-3">What Testers Compare This To</div>
            {data.feedback.recentComparableProducts.length === 0 ? (
              <div className="text-sm text-zinc-400">No data yet.</div>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {data.feedback.recentComparableProducts.map((c, i) => (
                  <li key={i} className="border-t border-zinc-800 pt-1.5 first:border-t-0 first:pt-0">
                    {c.text} <span className="text-xs text-zinc-400">— {fmtDate(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm font-medium mb-3">Recent Submissions</div>
            {data.feedback.recentSubmissions.length === 0 ? (
              <div className="text-sm text-zinc-400">No data yet.</div>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.feedback.recentSubmissions.map((s, i) => (
                  <li key={i} className="border-t border-zinc-800 pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span>{fmtDate(s.createdAt)}</span>
                      <span>·</span>
                      <span>{s.source}</span>
                      {s.rating !== null && (
                        <>
                          <span>·</span>
                          <span>{s.rating}/5</span>
                        </>
                      )}
                      {s.contextTab && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[200px]">{s.contextTab}</span>
                        </>
                      )}
                    </div>
                    <div>{s.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <p className="text-xs text-zinc-400 mt-4">
        Tag outbound links with <code>?utm_source=...&amp;utm_medium=...&amp;utm_campaign=...</code> to show up in Acquisition above —
        first-touch only, captured once per browser.
      </p>
    </div>
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!expected || !session || session !== expected) {
    notFound();
  }
  if (!isAdminAnalyticsConfigured()) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-xl font-semibold mb-2">Usage Analytics</h1>
        <p className="text-sm text-zinc-400">SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured on this deployment.</p>
      </div>
    );
  }
  const data = await getAdminAnalyticsSummary();
  return <Dashboard data={data} />;
}
