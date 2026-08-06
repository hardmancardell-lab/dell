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

const RATE_PATH_META: Record<RatePathTransparency, { label: string; badgeClass: string; badgeStyle?: React.CSSProperties }> = {
  EXPLICIT_OWN_PATH: {
    label: "Explicit own path",
    badgeClass: "jv-badge c-signal",
  },
  MARKET_CONDITIONED: {
    label: "Market-conditioned",
    badgeClass: "jv-badge",
    badgeStyle: { color: "var(--verdict)", borderColor: "var(--verdict-dim)", background: "rgba(240, 168, 104, 0.06)" },
  },
  OPAQUE_OR_POLITICAL: {
    label: "Opaque / political",
    badgeClass: "jv-badge c-neutral",
  },
};

function CentralBankCard({ bank }: { bank: CentralBankEntry }) {
  const meta = RATE_PATH_META[bank.ratePathTransparency];
  return (
    <div className="jv-card flex flex-col gap-2">
      <div className="jv-br-b" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>{bank.countryOrArea}</div>
          <div className="text-xs" style={{ color: "var(--text-2)" }}>{bank.institution}</div>
        </div>
        <span className={`${meta.badgeClass} whitespace-nowrap`} style={meta.badgeStyle}>{meta.label}</span>
      </div>
      <div className="text-xs" style={{ color: "var(--text-2)" }}>
        <span className="font-medium" style={{ color: "var(--text-1)" }}>{bank.publication}</span> — {bank.cadence}, {bank.horizon}
      </div>
      <p className="text-sm" style={{ color: "var(--text-1)" }}>{bank.methodology}</p>
      <div className="text-xs" style={{ color: "var(--text-2)" }}>
        <span className="font-medium">Forecasts:</span> {bank.forecasts.join("; ")}
      </div>
      <div className="text-xs" style={{ color: "var(--text-2)" }}>
        <span className="font-medium">Access:</span> {bank.access.method}
        {bank.access.cost ? ` (${bank.access.cost})` : ""} — automation: {bank.automationFeasibility}
        {bank.access.url && (
          <>
            {" · "}
            <a href={bank.access.url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--text-1)" }}>
              source ↗
            </a>
          </>
        )}
      </div>
      <p className="text-xs italic" style={{ color: "var(--text-2)" }}>{bank.pipelineRole}</p>
    </div>
  );
}

/** Exported so Currency (Trading Agent) can mount the same real registry/content, reused rather than duplicated — see page.tsx's "Central Banks" tab. */
export function InternationalCentralBanksView() {
  return (
    <div className="jarvis flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--text-2)" }}>
        Static reference content extending this app&apos;s Fed-only Economic Outlook to 13 other central banks — real
        institutions, real publications, and an honest read on how much to trust each one&apos;s rate-path signal.
        Nothing here is fetched live; this is a lookup for where to go get real international rate data, not an
        automated pipeline.
      </p>
      <div className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" aria-hidden="true" />
          The Critical Distinction
        </div>
        <p>{CENTRAL_BANK_CRITICAL_DISTINCTION}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CENTRAL_BANKS.map((bank) => (
          <CentralBankCard key={bank.id} bank={bank} />
        ))}
      </div>
      {CENTRAL_BANK_COVERAGE_GAPS.map((g) => (
        <div
          key={g.slice(0, 40)}
          className="jv-card text-xs"
          style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}
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
    <div className="jv-card flex flex-col gap-3">
      <div className="jv-br-b" />
      <h3 className="jv-label" style={{ marginBottom: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

function IndicatorCard({ item }: { item: OutlookIndicator }) {
  return (
    <div className="pt-2 first:pt-0 first:border-t-0" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{item.indicator}</span>
        <span className="text-sm font-mono" style={{ color: "var(--text-1)" }}>{item.currentReading}</span>
      </div>
      <p className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>{item.roleInOutlook}</p>
      <p className="text-xs mt-0.5 italic" style={{ color: "var(--text-2)" }}>How derived: {item.howDerived}</p>
      <div className="text-[11px] mt-0.5 flex gap-3" style={{ color: "var(--text-2)" }}>
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
    <div className="pt-3 first:pt-0 first:border-t-0" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>{entry.versionId}</span>
          <span className="text-xs ml-2" style={{ color: "var(--text-2)" }}>logged {fmtDate(entry.loggedDate)}</span>
        </div>
        <span className={graded ? "jv-badge c-signal" : "jv-badge c-neutral"}>
          {graded ? "Graded" : "Ungraded"}
        </span>
      </div>
      <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
        Regime at call: <span className="font-medium" style={{ color: "var(--text-1)" }}>{entry.regimeTagAtCall}</span> — house view: {entry.houseViewPathAtCall}
      </p>
      {entry.keyFalsificationTriggers.length > 0 && (
        <ul className="text-xs mt-1 list-disc list-inside" style={{ color: "var(--text-2)" }}>
          {entry.keyFalsificationTriggers.map((t) => (
            <li key={t.slice(0, 40)}>{t}</li>
          ))}
        </ul>
      )}

      {graded && !editing && (
        <div className="text-xs mt-2 flex flex-col gap-1" style={{ color: "var(--text-1)" }}>
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
          <label className="flex items-center gap-2" style={{ color: "var(--text-1)" }}>
            <input type="checkbox" checked={form.didTriggersFire === true} onChange={(e) => setForm((f) => ({ ...f, didTriggersFire: e.target.checked }))} />
            Triggers fired
          </label>
          <input
            className="jv-input"
            placeholder="Actual Fed action"
            value={form.actualFedAction ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, actualFedAction: e.target.value || null }))}
          />
          <input
            className="jv-input"
            placeholder="Actual market reaction"
            value={form.actualMarketReaction ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, actualMarketReaction: e.target.value || null }))}
          />
          <label className="flex items-center gap-2" style={{ color: "var(--text-1)" }}>
            <input
              type="checkbox"
              checked={form.wasRegimeTagCorrect === true}
              onChange={(e) => setForm((f) => ({ ...f, wasRegimeTagCorrect: e.target.checked }))}
            />
            Regime tag was correct
          </label>
          <label className="flex items-center gap-2" style={{ color: "var(--text-1)" }}>
            <input
              type="checkbox"
              checked={form.wasHouseViewPathCorrect === true}
              onChange={(e) => setForm((f) => ({ ...f, wasHouseViewPathCorrect: e.target.checked }))}
            />
            House view path was correct
          </label>
          <textarea
            className="jv-input"
            placeholder="What broke or held?"
            value={form.notesOnWhatBrokeOrHeld ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, notesOnWhatBrokeOrHeld: e.target.value || null }))}
          />
          <textarea
            className="jv-input"
            placeholder="Lesson for next version"
            value={form.lessonForNextVersion ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, lessonForNextVersion: e.target.value || null }))}
          />
          <div className="flex gap-2">
            <button disabled={saving} onClick={save} className="jv-btn" style={{ padding: "6px 14px" }}>
              {saving ? "Saving…" : "Save grading"}
            </button>
            <button onClick={() => setEditing(false)} className="jv-btn-outline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs underline mt-2" style={{ color: "var(--text-2)" }}>
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
    <div className="jarvis flex flex-col gap-4">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
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
          className="jv-select"
        >
          {REFRESH_REASONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button onClick={runRefresh} disabled={refreshing} className="jv-btn">
          {refreshing ? "Generating (real FRED data + one Claude pass, ~15-30s)…" : outlook ? "Refresh Outlook" : "Generate First Outlook"}
        </button>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setView("narrative")} className={view === "narrative" ? "jv-btn" : "jv-btn-outline"}>
            Narrative
          </button>
          <button onClick={() => setView("scorecard")} className={view === "scorecard" ? "jv-btn" : "jv-btn-outline"}>
            Scorecard ({scorecard.length})
          </button>
          <button onClick={() => setView("international")} className={view === "international" ? "jv-btn" : "jv-btn-outline"}>
            International
          </button>
        </div>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading…</p>}
      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {!loading && !outlook && !error && (
        <div className="jv-card text-center text-sm" style={{ borderStyle: "dashed", color: "var(--text-2)" }}>
          No Economic Outlook version exists yet. Click &quot;Generate First Outlook&quot; above — real FRED data
          feeds are fetched, then one Claude call synthesizes the qualitative layer strictly from those real numbers.
        </div>
      )}

      {outlook && view === "narrative" && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-2)" }}>
            <span>
              Version <span className="font-mono">{outlook.meta.versionId}</span>
            </span>
            <span>As of {fmtDate(outlook.meta.asOfDate)}</span>
            <span>Reason: {REFRESH_REASONS.find((r) => r.id === outlook.meta.refreshReason)?.label}</span>
            {outlook.meta.priorVersionId && <span>Prior: {outlook.meta.priorVersionId}</span>}
            <span>Next scheduled: {fmtDate(outlook.meta.nextScheduledRefresh)}</span>
          </div>

          <div className="jv-verdict-panel">
            <div className="jv-vp-label">
              <span className="jv-dot" aria-hidden="true" />
              At a Glance
            </div>
            <p>{outlook.outputLayers.glance}</p>
          </div>

          <Section title={`Regime — ${outlook.regimeTag.label}`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm" style={{ color: "var(--text-1)" }}>
              <div>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Cycle phase</span>
                {outlook.regimeTag.cyclePhase.replace(/_/g, " ")}
              </div>
              <div>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Dual-mandate balance</span>
                {outlook.regimeTag.dualMandateBalance}
              </div>
              <div>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Financial conditions</span>
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
            <div className="text-sm flex flex-col gap-1.5" style={{ color: "var(--text-1)" }}>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Current target range</span>
                {outlook.policyStance.currentTargetRange}
              </p>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>House view path</span>
                {outlook.policyStance.houseViewPath}
              </p>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Market-implied path</span>
                {outlook.policyStance.marketImpliedPath}
              </p>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Gap analysis</span>
                {outlook.policyStance.gapAnalysis}
              </p>
            </div>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Upside Risks">
              {outlook.riskBalance.upsideRisks.map((r) => (
                <div key={r.scenario} className="pt-2 first:pt-0 first:border-t-0 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                  <div className="font-medium" style={{ color: "var(--text-0)" }}>{r.scenario}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>Trigger: {r.trigger}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>Market implication: {r.marketImplication}</div>
                </div>
              ))}
            </Section>
            <Section title="Downside Risks">
              {outlook.riskBalance.downsideRisks.map((r) => (
                <div key={r.scenario} className="pt-2 first:pt-0 first:border-t-0 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                  <div className="font-medium" style={{ color: "var(--text-0)" }}>{r.scenario}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>Trigger: {r.trigger}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>Market implication: {r.marketImplication}</div>
                </div>
              ))}
            </Section>
          </div>

          <Section title="Adversarial Self-Q&A">
            {outlook.selfQa.map((qa) => (
              <div key={qa.question} className="pt-2 first:pt-0 first:border-t-0 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="font-medium" style={{ color: "var(--text-0)" }}>{qa.question}</div>
                <div className="mt-0.5" style={{ color: "var(--text-1)" }}>{qa.answer}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--verdict)" }}>Falsification trigger: {qa.falsificationTrigger}</div>
              </div>
            ))}
          </Section>

          <Section title="Trading Parameters">
            <div className="text-sm flex flex-col gap-2" style={{ color: "var(--text-1)" }}>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Vol regime</span>
                {outlook.tradingParameters.volRegime.replace(/_/g, " ")}
              </p>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Calendar-effects priority</span>
                {outlook.tradingParameters.calendarEffectsPriority.length > 0
                  ? outlook.tradingParameters.calendarEffectsPriority.join(", ")
                  : "—"}
              </p>
              <p>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Mean-reversion window confidence</span>
                {outlook.tradingParameters.meanReversionWindowConfidence}
              </p>
              <div>
                <span className="text-xs block" style={{ color: "var(--text-2)" }}>Event-vol catalysts</span>
                {outlook.tradingParameters.eventVolCatalysts.length === 0 ? (
                  <span className="text-xs" style={{ color: "var(--text-2)" }}>
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
              <p className="text-sm" style={{ color: "var(--text-2)" }}>No triggers flagged in this version.</p>
            ) : (
              <ul className="text-sm list-disc list-inside" style={{ color: "var(--text-1)" }}>
                {outlook.outputLayers.triggerFeed.map((t) => (
                  <li key={t.slice(0, 40)}>{t}</li>
                ))}
              </ul>
            )}
          </Section>

          {outlook.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 40)}
              className="jv-card text-xs"
              style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}
            >
              {d}
            </div>
          ))}

          <button
            onClick={logToScorecard}
            disabled={loggingToScorecard || alreadyLogged}
            className="jv-btn-outline self-start"
          >
            {alreadyLogged ? "This version is already logged to the Scorecard" : loggingToScorecard ? "Logging…" : "Log This Version to Scorecard"}
          </button>
        </>
      )}

      {view === "scorecard" && (
        <Section title="Scorecard Log">
          <p className="text-xs -mt-1" style={{ color: "var(--text-2)" }}>
            Append-only. Each entry captures the real call (regime tag, house-view path, falsification triggers) at
            the moment it was logged; grading is filled in later, once outcome data exists (recommended cadence:
            6-8 weeks after logging).
          </p>
          {scorecard.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>No entries logged yet.</p>
          ) : (
            scorecard.map((entry) => <ScorecardRow key={entry.versionId} entry={entry} onGraded={loadScorecard} />)
          )}
        </Section>
      )}

      {view === "international" && <InternationalCentralBanksView />}
    </div>
  );
}
