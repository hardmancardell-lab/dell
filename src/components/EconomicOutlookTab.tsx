"use client";

import { useCallback, useEffect, useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { CENTRAL_BANKS, CENTRAL_BANK_COVERAGE_GAPS, CENTRAL_BANK_CRITICAL_DISTINCTION } from "@/lib/agents/economic-outlook/central-bank-registry";
import type {
  CentralBankEntry,
  EconomicOutlook,
  OutlookIndicator,
  RatePathTransparency,
  RefreshReason,
  ScorecardEntry,
  ScorecardGrading,
} from "@/lib/agents/economic-outlook/types";

const REFRESH_REASONS: { id: RefreshReason; label: string }[] = [
  { id: "scheduled_fomc_cycle", label: "Scheduled FOMC cycle" },
  { id: "cpi_print", label: "CPI print" },
  { id: "nfp_print", label: "NFP print" },
  { id: "fomc_statement", label: "FOMC statement" },
  { id: "ad_hoc_material_change", label: "Ad hoc / material change" },
];

const RATE_PATH_META: Record<RatePathTransparency, { label: string; classes: string }> = {
  EXPLICIT_OWN_PATH: {
    label: "Explicit own path",
    classes: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  },
  MARKET_CONDITIONED: {
    label: "Market-conditioned",
    classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  OPAQUE_OR_POLITICAL: {
    label: "Opaque / political",
    classes: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function CentralBankCard({ bank }: { bank: CentralBankEntry }) {
  const meta = RATE_PATH_META[bank.ratePathTransparency];
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{bank.countryOrArea}</div>
          <div className="text-xs text-zinc-500">{bank.institution}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${meta.classes}`}>{meta.label}</span>
      </div>
      <div className="text-xs text-zinc-500">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{bank.publication}</span> — {bank.cadence}, {bank.horizon}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{bank.methodology}</p>
      <div className="text-xs text-zinc-500">
        <span className="font-medium">Forecasts:</span> {bank.forecasts.join("; ")}
      </div>
      <div className="text-xs text-zinc-500">
        <span className="font-medium">Access:</span> {bank.access.method}
        {bank.access.cost ? ` (${bank.access.cost})` : ""} — automation: {bank.automationFeasibility}
        {bank.access.url && (
          <>
            {" · "}
            <a href={bank.access.url} target="_blank" rel="noopener noreferrer" className="underline">
              source ↗
            </a>
          </>
        )}
      </div>
      <p className="text-xs text-zinc-400 italic">{bank.pipelineRole}</p>
    </div>
  );
}

/** Exported so Currency (Trading Agent) can mount the same real registry/content, reused rather than duplicated — see page.tsx's "Central Banks" tab. */
export function InternationalCentralBanksView() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Static reference content extending this app&apos;s Fed-only Economic Outlook to 13 other central banks — real
        institutions, real publications, and an honest read on how much to trust each one&apos;s rate-path signal.
        Nothing here is fetched live; this is a lookup for where to go get real international rate data, not an
        automated pipeline.
      </p>
      <div className="rounded-lg border-2 border-zinc-900 dark:border-zinc-100 p-4">
        <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-1">The Critical Distinction</h3>
        <p className="text-sm leading-relaxed">{CENTRAL_BANK_CRITICAL_DISTINCTION}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CENTRAL_BANKS.map((bank) => (
          <CentralBankCard key={bank.id} bank={bank} />
        ))}
      </div>
      {CENTRAL_BANK_COVERAGE_GAPS.map((g) => (
        <div
          key={g.slice(0, 40)}
          className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
        >
          {g}
        </div>
      ))}
    </div>
  );
}

function fmtDate(d: string): string {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

function IndicatorCard({ item }: { item: OutlookIndicator }) {
  return (
    <div className="border-t border-zinc-100 dark:border-zinc-900 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{item.indicator}</span>
        <span className="text-sm font-mono">{item.currentReading}</span>
      </div>
      <p className="text-xs text-zinc-500 mt-0.5">{item.roleInOutlook}</p>
      <p className="text-xs text-zinc-400 mt-0.5 italic">How derived: {item.howDerived}</p>
      <div className="text-[11px] text-zinc-400 mt-0.5 flex gap-3">
        <span>Source: {item.source}</span>
        {item.lastChangedMeaningfully && <span>Last meaningful change: {item.lastChangedMeaningfully}</span>}
      </div>
    </div>
  );
}

function ScorecardRow({ entry, onGraded }: { entry: ScorecardEntry; onGraded: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const g = entry.grading;
  const [form, setForm] = useState<ScorecardGrading>(g);

  const graded = g.gradedDate !== null;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/economic-outlook/scorecard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: entry.versionId, grading: form }),
      });
      setEditing(false);
      onGraded();
    } finally {
      setSaving(false);
    }
  }, [entry.versionId, form, onGraded]);

  return (
    <div className="border-t border-zinc-100 dark:border-zinc-900 pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">{entry.versionId}</span>
          <span className="text-xs text-zinc-400 ml-2">logged {fmtDate(entry.loggedDate)}</span>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
            graded ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {graded ? "Graded" : "Ungraded"}
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-1">
        Regime at call: <span className="font-medium">{entry.regimeTagAtCall}</span> — house view: {entry.houseViewPathAtCall}
      </p>
      {entry.keyFalsificationTriggers.length > 0 && (
        <ul className="text-xs text-zinc-400 mt-1 list-disc list-inside">
          {entry.keyFalsificationTriggers.map((t) => (
            <li key={t.slice(0, 40)}>{t}</li>
          ))}
        </ul>
      )}

      {graded && !editing && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 mt-2 flex flex-col gap-1">
          <span>Triggers fired: {g.didTriggersFire === null ? "—" : g.didTriggersFire ? "Yes" : "No"}</span>
          <span>Actual Fed action: {g.actualFedAction ?? "—"}</span>
          <span>Actual market reaction: {g.actualMarketReaction ?? "—"}</span>
          <span>Regime tag correct: {g.wasRegimeTagCorrect === null ? "—" : g.wasRegimeTagCorrect ? "Yes" : "No"}</span>
          <span>House view path correct: {g.wasHouseViewPathCorrect === null ? "—" : g.wasHouseViewPathCorrect ? "Yes" : "No"}</span>
          {g.notesOnWhatBrokeOrHeld && <span>Notes: {g.notesOnWhatBrokeOrHeld}</span>}
          {g.lessonForNextVersion && <span>Lesson: {g.lessonForNextVersion}</span>}
        </div>
      )}

      {editing ? (
        <div className="mt-2 flex flex-col gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.didTriggersFire === true} onChange={(e) => setForm((f) => ({ ...f, didTriggersFire: e.target.checked }))} />
            Triggers fired
          </label>
          <input
            className="border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent"
            placeholder="Actual Fed action"
            value={form.actualFedAction ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, actualFedAction: e.target.value || null }))}
          />
          <input
            className="border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent"
            placeholder="Actual market reaction"
            value={form.actualMarketReaction ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, actualMarketReaction: e.target.value || null }))}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.wasRegimeTagCorrect === true}
              onChange={(e) => setForm((f) => ({ ...f, wasRegimeTagCorrect: e.target.checked }))}
            />
            Regime tag was correct
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.wasHouseViewPathCorrect === true}
              onChange={(e) => setForm((f) => ({ ...f, wasHouseViewPathCorrect: e.target.checked }))}
            />
            House view path was correct
          </label>
          <textarea
            className="border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent"
            placeholder="What broke or held?"
            value={form.notesOnWhatBrokeOrHeld ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, notesOnWhatBrokeOrHeld: e.target.value || null }))}
          />
          <textarea
            className="border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent"
            placeholder="Lesson for next version"
            value={form.lessonForNextVersion ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, lessonForNextVersion: e.target.value || null }))}
          />
          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={save}
              className="px-3 py-1 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save grading"}
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1 rounded border border-zinc-300 dark:border-zinc-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs underline text-zinc-500 mt-2">
          {graded ? "Edit grading" : "Grade this call"}
        </button>
      )}
    </div>
  );
}

export function EconomicOutlookTab() {
  const [outlook, setOutlook] = useState<EconomicOutlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [refreshReason, setRefreshReason] = useState<RefreshReason>("ad_hoc_material_change");
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"narrative" | "scorecard" | "international">("narrative");
  const [scorecard, setScorecard] = useState<ScorecardEntry[]>([]);
  const [loggingToScorecard, setLoggingToScorecard] = useState(false);
  const { track } = useTrackEvent();

  const loadLatest = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/economic-outlook/latest")
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) {
          if (typeof json.error === "string" && json.error.includes("No Economic Outlook version exists")) {
            setOutlook(null);
          } else {
            setError(json.error ?? "Unknown error");
          }
        } else {
          setOutlook(json as EconomicOutlook);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, []);

  const loadScorecard = useCallback(() => {
    fetch("/api/economic-outlook/scorecard")
      .then((res) => res.json())
      .then((json) => setScorecard(json.entries ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (checked) return;
    setChecked(true);
    loadLatest();
    loadScorecard();
    track("economic_outlook_viewed", { tab: "Economic Outlook" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/economic-outlook/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshReason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Economic Outlook", metadata: { endpoint: "economic-outlook/refresh", status: res.status } });
      } else {
        setOutlook(json as EconomicOutlook);
        track("economic_outlook_refreshed", { tab: "Economic Outlook", metadata: { refreshReason } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRefreshing(false);
    }
  }, [refreshReason, track]);

  const logToScorecard = useCallback(async () => {
    if (!outlook) return;
    setLoggingToScorecard(true);
    try {
      await fetch("/api/economic-outlook/scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: outlook.meta.versionId }),
      });
      loadScorecard();
      track("economic_outlook_scorecard_logged", { tab: "Economic Outlook" });
    } finally {
      setLoggingToScorecard(false);
    }
  }, [outlook, loadScorecard, track]);

  const alreadyLogged = outlook ? scorecard.some((s) => s.versionId === outlook.meta.versionId) : false;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-zinc-500 text-sm">
        A versioned macro workstream modeled on the College Fed Challenge format — real FRED data for every hard
        number, one Claude pass to synthesize the qualitative read (regime, risk balance, adversarial self-Q&amp;A),
        never fabricating a figure it doesn&apos;t have (market-implied rate path, r-star, and a live FOMC calendar
        are honestly flagged as unavailable — see Data Limitations below). Refresh is always manual — this never
        runs automatically.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={refreshReason}
          onChange={(e) => setRefreshReason(e.target.value as RefreshReason)}
          className="text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 bg-transparent"
        >
          {REFRESH_REASONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          onClick={runRefresh}
          disabled={refreshing}
          className="text-sm px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {refreshing ? "Generating (real FRED data + one Claude pass, ~15-30s)…" : outlook ? "Refresh Outlook" : "Generate First Outlook"}
        </button>
        <div className="flex rounded overflow-hidden border border-zinc-300 dark:border-zinc-700 text-sm ml-auto">
          <button
            onClick={() => setView("narrative")}
            className={`px-3 py-1.5 ${view === "narrative" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
          >
            Narrative
          </button>
          <button
            onClick={() => setView("scorecard")}
            className={`px-3 py-1.5 ${view === "scorecard" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
          >
            Scorecard ({scorecard.length})
          </button>
          <button
            onClick={() => setView("international")}
            className={`px-3 py-1.5 ${view === "international" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
          >
            International
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !outlook && !error && (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">
          No Economic Outlook version exists yet. Click &quot;Generate First Outlook&quot; above — real FRED data
          feeds are fetched, then one Claude call synthesizes the qualitative layer strictly from those real numbers.
        </div>
      )}

      {outlook && view === "narrative" && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>
              Version <span className="font-mono">{outlook.meta.versionId}</span>
            </span>
            <span>As of {fmtDate(outlook.meta.asOfDate)}</span>
            <span>Reason: {REFRESH_REASONS.find((r) => r.id === outlook.meta.refreshReason)?.label}</span>
            {outlook.meta.priorVersionId && <span>Prior: {outlook.meta.priorVersionId}</span>}
            <span>Next scheduled: {fmtDate(outlook.meta.nextScheduledRefresh)}</span>
          </div>

          <div className="rounded-lg border-2 border-zinc-900 dark:border-zinc-100 p-4">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-1">At a Glance</h3>
            <p className="text-sm leading-relaxed">{outlook.outputLayers.glance}</p>
          </div>

          <Section title={`Regime — ${outlook.regimeTag.label}`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div>
                <span className="text-xs text-zinc-500 block">Cycle phase</span>
                {outlook.regimeTag.cyclePhase.replace(/_/g, " ")}
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Dual-mandate balance</span>
                {outlook.regimeTag.dualMandateBalance}
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Financial conditions</span>
                {outlook.regimeTag.financialConditionsStance}
              </div>
            </div>
          </Section>

          <Section title="Dual-Mandate Scorecard — Labor">
            {outlook.dualMandateScorecard.labor.map((i) => (
              <IndicatorCard key={i.indicator} item={i} />
            ))}
          </Section>

          <Section title="Dual-Mandate Scorecard — Inflation">
            {outlook.dualMandateScorecard.inflation.map((i) => (
              <IndicatorCard key={i.indicator} item={i} />
            ))}
          </Section>

          <Section title="Growth & Financial Conditions">
            {outlook.growthAndFinancialConditions.map((i) => (
              <IndicatorCard key={i.indicator} item={i} />
            ))}
          </Section>

          <Section title="Policy Stance">
            <div className="text-sm flex flex-col gap-1.5">
              <p>
                <span className="text-xs text-zinc-500 block">Current target range</span>
                {outlook.policyStance.currentTargetRange}
              </p>
              <p>
                <span className="text-xs text-zinc-500 block">House view path</span>
                {outlook.policyStance.houseViewPath}
              </p>
              <p>
                <span className="text-xs text-zinc-500 block">Market-implied path</span>
                {outlook.policyStance.marketImpliedPath}
              </p>
              <p>
                <span className="text-xs text-zinc-500 block">Gap analysis</span>
                {outlook.policyStance.gapAnalysis}
              </p>
            </div>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Upside Risks">
              {outlook.riskBalance.upsideRisks.map((r) => (
                <div key={r.scenario} className="border-t border-zinc-100 dark:border-zinc-900 pt-2 first:border-t-0 first:pt-0 text-sm">
                  <div className="font-medium">{r.scenario}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Trigger: {r.trigger}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Market implication: {r.marketImplication}</div>
                </div>
              ))}
            </Section>
            <Section title="Downside Risks">
              {outlook.riskBalance.downsideRisks.map((r) => (
                <div key={r.scenario} className="border-t border-zinc-100 dark:border-zinc-900 pt-2 first:border-t-0 first:pt-0 text-sm">
                  <div className="font-medium">{r.scenario}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Trigger: {r.trigger}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Market implication: {r.marketImplication}</div>
                </div>
              ))}
            </Section>
          </div>

          <Section title="Adversarial Self-Q&A">
            {outlook.selfQa.map((qa) => (
              <div key={qa.question} className="border-t border-zinc-100 dark:border-zinc-900 pt-2 first:border-t-0 first:pt-0 text-sm">
                <div className="font-medium">{qa.question}</div>
                <div className="text-zinc-600 dark:text-zinc-300 mt-0.5">{qa.answer}</div>
                <div className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">Falsification trigger: {qa.falsificationTrigger}</div>
              </div>
            ))}
          </Section>

          <Section title="Trading Parameters">
            <div className="text-sm flex flex-col gap-2">
              <p>
                <span className="text-xs text-zinc-500 block">Vol regime</span>
                {outlook.tradingParameters.volRegime.replace(/_/g, " ")}
              </p>
              <p>
                <span className="text-xs text-zinc-500 block">Calendar-effects priority</span>
                {outlook.tradingParameters.calendarEffectsPriority.length > 0
                  ? outlook.tradingParameters.calendarEffectsPriority.join(", ")
                  : "—"}
              </p>
              <p>
                <span className="text-xs text-zinc-500 block">Mean-reversion window confidence</span>
                {outlook.tradingParameters.meanReversionWindowConfidence}
              </p>
              <div>
                <span className="text-xs text-zinc-500 block">Event-vol catalysts</span>
                {outlook.tradingParameters.eventVolCatalysts.length === 0 ? (
                  <span className="text-xs text-zinc-400">
                    None populated — no live FOMC/economic-calendar data source is integrated in this app.
                  </span>
                ) : (
                  <ul className="list-disc list-inside">
                    {outlook.tradingParameters.eventVolCatalysts.map((c) => (
                      <li key={c.event}>
                        {c.date} — {c.event} ({c.expectedVolSensitivity})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          <Section title="Trigger Feed">
            {outlook.outputLayers.triggerFeed.length === 0 ? (
              <p className="text-sm text-zinc-400">No triggers flagged in this version.</p>
            ) : (
              <ul className="text-sm list-disc list-inside">
                {outlook.outputLayers.triggerFeed.map((t) => (
                  <li key={t.slice(0, 40)}>{t}</li>
                ))}
              </ul>
            )}
          </Section>

          {outlook.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 40)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}

          <button
            onClick={logToScorecard}
            disabled={loggingToScorecard || alreadyLogged}
            className="text-sm self-start px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-50"
          >
            {alreadyLogged ? "This version is already logged to the Scorecard" : loggingToScorecard ? "Logging…" : "Log This Version to Scorecard"}
          </button>
        </>
      )}

      {view === "scorecard" && (
        <Section title="Scorecard Log">
          <p className="text-xs text-zinc-500 -mt-1">
            Append-only. Each entry captures the real call (regime tag, house-view path, falsification triggers) at
            the moment it was logged; grading is filled in later, once outcome data exists (recommended cadence:
            6-8 weeks after logging).
          </p>
          {scorecard.length === 0 ? (
            <p className="text-sm text-zinc-400">No entries logged yet.</p>
          ) : (
            scorecard.map((entry) => <ScorecardRow key={entry.versionId} entry={entry} onGraded={loadScorecard} />)
          )}
        </Section>
      )}

      {view === "international" && <InternationalCentralBanksView />}
    </div>
  );
}
