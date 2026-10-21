"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FayeFullBody } from "@/components/faye/FayeFullBody";
import type { FayeMood } from "@/components/faye/FayeAvatar";
import { CHART_SUITES, type EvalSuite } from "@/lib/faye/lab/config";
import { percent, seriesFor, shortDate, shortTime, wilson } from "@/lib/faye/lab/stats";
import { CORRECTION_KINDS, ITEM_SUITES, type CorpusNote, type Correction, type CorrectionKind, type ExamItem, type FeedbackItem, type ItemSuite } from "@/lib/faye/lab/types";
import { LAB_COPY, SUITE_NAMES } from "./copy";
import { PassChart } from "./LabChart";
import type { CorrectionForm, LabState, LabStore } from "./labStore";
import { LAB_CSS } from "./LabStyles";

/**
 * The Lab screen. Pure view: it draws `state` and calls `store`. Every question, answer, note and excerpt is drawn as a React text node,
 * so text that contains markup shows as the characters it is made of, never as HTML. Nothing in this file sets HTML.
 *
 * Accessibility: one h1, h2 sections in order, a polite live region for results, every control has a label, buttons name the item they
 * act on, touch targets are 44 px on phones, and nothing depends on colour alone (the exam set has a dashed edge and a label).
 */

export interface LabViewProps {
  state: LabState;
  store: LabStore;
}

const kindDefaultSuite = (k: CorrectionKind): ItemSuite => (k === "guardrail" ? "guardrail" : k === "voice" ? "persona" : "domain");
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

function focusSoon(id: string) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.focus()));
}

export function LabView({ state, store }: LabViewProps) {
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    main: `${uid}-main`,
    feedback: `${uid}-feedback`,
    teach: `${uid}-teach`,
    exams: `${uid}-exams`,
    notes: `${uid}-notes`,
    tests: `${uid}-tests`,
    question: `${uid}-question`,
  };
  const [form, setForm] = useState<CorrectionForm>({ kind: "answer", question: "", betterAnswer: "", badExcerpt: "" });
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [confirmLong, setConfirmLong] = useState(false);
  const busy = (k: string) => state.busy.includes(k);
  const ready = state.load === "ready";
  const reason = state.mood.reason;
  const mood: FayeMood = ready || state.load === "not_ready" ? state.mood.mood : state.load === "disabled" ? "offline" : "idle";

  async function submitCorrection(e: FormEvent) {
    e.preventDefault();
    const ok = await store.saveCorrection(form);
    if (ok) {
      setForm({ kind: "answer", question: "", betterAnswer: "", badExcerpt: "" });
      focusSoon(ids.teach);
    }
  }

  function teachFrom(f: FeedbackItem) {
    setForm((old) => ({ ...old, kind: f.rating === "off_voice" ? "voice" : "answer", badExcerpt: f.answerExcerpt.slice(0, 200) }));
    focusSoon(ids.question);
    if (typeof document !== "undefined") document.getElementById(ids.question)?.scrollIntoView({ block: "center" });
  }

  const feedbackShown = showAllFeedback ? state.feedback : state.feedback.slice(0, 6);
  const counts = state.counts;
  const latestGuardrail = seriesFor(state.runs, "guardrail", 1)[0];
  const sortedRuns = state.runs.slice().sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));

  return (
    <div className="fl" data-faye-lab>
      <style>{LAB_CSS}</style>
      <a className="fl-skip" href={`#${ids.main}`}>
        {LAB_COPY.skip}
      </a>
      <a className="fl-back" href="/">
        {LAB_COPY.back}
      </a>

      <header className="fl-hero">
        <div className="fl-hero-fig">
          <FayeFullBody mood={mood} height={176} announce />
        </div>
        <div className="fl-hero-text">
          <p className="fl-kicker">{LAB_COPY.ownerOnly}</p>
          <h1 className="fl-title" id={ids.title} tabIndex={-1}>
            {LAB_COPY.title}
          </h1>
          <p className="fl-lead">{LAB_COPY.lead}</p>
          {ready ? (
            <p className="fl-status" data-reason={reason}>
              {LAB_COPY.status[reason]}
            </p>
          ) : null}
          {ready && counts ? (
            <ul className="fl-stats" aria-label="Totals">
              <Stat label={LAB_COPY.stats.feedback} value={counts.feedback} />
              <Stat label={LAB_COPY.stats.correctionsNew} value={counts.correctionsNew} />
              <Stat label={LAB_COPY.stats.training} value={counts.train} />
              <Stat label={LAB_COPY.stats.heldOut} value={counts.heldout} />
              <Stat label={LAB_COPY.stats.notesPending} value={counts.notesPending} />
            </ul>
          ) : null}
        </div>
      </header>

      {ready ? (
        <nav className="fl-nav" aria-label={LAB_COPY.navLabel}>
          <a href={`#${ids.feedback}`}>{LAB_COPY.sections.feedback}</a>
          <a href={`#${ids.teach}`}>{LAB_COPY.sections.teach}</a>
          <a href={`#${ids.exams}`}>{LAB_COPY.sections.exams}</a>
          <a href={`#${ids.notes}`}>{LAB_COPY.sections.notes}</a>
          <a href={`#${ids.tests}`}>{LAB_COPY.sections.tests}</a>
        </nav>
      ) : null}

      <div className="fl-live" role="status" aria-live="polite" aria-atomic="true" data-tone={state.notice?.tone ?? "ok"}>
        {state.notice ? <span key={state.notice.seq}>{state.notice.text}</span> : null}
      </div>

      <main className="fl-main" id={ids.main} tabIndex={-1}>
        {state.load === "idle" || state.load === "loading" ? <p className="fl-loading">{LAB_COPY.loading}</p> : null}
        {state.load === "error" ? (
          <section className="fl-banner" data-tone="danger">
            <strong>{state.loadError}</strong>
            <div className="fl-row" style={{ marginTop: 10 }}>
              <button type="button" className="fl-btn" onClick={() => void store.load()}>
                {LAB_COPY.retry}
              </button>
            </div>
          </section>
        ) : null}
        {state.load === "disabled" ? (
          <section className="fl-banner">
            <strong>{LAB_COPY.disabled.title}</strong>
            <p>{LAB_COPY.disabled.body}</p>
          </section>
        ) : null}
        {state.load === "not_ready" ? (
          <section className="fl-banner">
            <strong>{LAB_COPY.notReady.title}</strong>
            <p>{LAB_COPY.notReady.body}</p>
          </section>
        ) : null}

        {ready ? (
          <>
            {/* ---------------------------------------------------------------- feedback */}
            <section className="fl-sec" id={ids.feedback} aria-labelledby={`${ids.feedback}-h`}>
              <h2 className="fl-h" id={`${ids.feedback}-h`} tabIndex={-1}>
                {LAB_COPY.sections.feedback}
              </h2>
              <p className="fl-hint">{LAB_COPY.feedback.hint}</p>
              {state.feedbackSummary.total > 0 ? (
                <ul className="fl-stats" aria-label={LAB_COPY.feedback.countLabel}>
                  {(["good", "wrong", "too_long", "off_voice"] as const).map((r) => (
                    <Stat key={r} label={LAB_COPY.feedback.rating[r]} value={state.feedbackSummary[r]} />
                  ))}
                </ul>
              ) : null}
              {state.feedback.length === 0 ? (
                <p className="fl-empty">{LAB_COPY.feedback.empty}</p>
              ) : (
                <ul className="fl-list">
                  {feedbackShown.map((f) => (
                    <li className="fl-card" key={f.id}>
                      <div className="fl-row" style={{ marginTop: 0 }}>
                        <span className="fl-chip" data-tone={f.rating === "good" ? "good" : f.rating === "wrong" ? "bad" : "warn"}>
                          {LAB_COPY.feedback.rating[f.rating] ?? f.rating}
                        </span>
                        <span className="fl-small">{shortDate(f.createdAt)}</span>
                      </div>
                      <p className="fl-quote">{f.answerExcerpt}</p>
                      {f.note ? (
                        <p className="fl-meta">
                          {LAB_COPY.feedback.yourNote}: {f.note}
                        </p>
                      ) : null}
                      {f.rating !== "good" ? (
                        <div className="fl-row">
                          <button type="button" className="fl-btn" onClick={() => teachFrom(f)} aria-label={`${LAB_COPY.feedback.teachFromThis}: ${trim(f.answerExcerpt, 40)}`}>
                            {LAB_COPY.feedback.teachFromThis}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {state.feedback.length > 6 ? (
                <div className="fl-row">
                  <button type="button" className="fl-btn" aria-expanded={showAllFeedback} onClick={() => setShowAllFeedback((v) => !v)}>
                    {showAllFeedback ? "Show fewer" : `Show all ${state.feedback.length}`}
                  </button>
                </div>
              ) : null}
            </section>

            {/* ---------------------------------------------------------------- teach me */}
            <section className="fl-sec" id={ids.teach} aria-labelledby={`${ids.teach}-h`}>
              <h2 className="fl-h" id={`${ids.teach}-h`} tabIndex={-1}>
                {LAB_COPY.sections.teach}
              </h2>
              <p className="fl-hint">{LAB_COPY.teach.hint}</p>
              <form className="fl-form" onSubmit={submitCorrection}>
                <label className="fl-field">
                  <span>{LAB_COPY.teach.kind}</span>
                  <select className="fl-select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CorrectionKind })}>
                    {CORRECTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LAB_COPY.teach.kinds[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fl-field">
                  <span>
                    {LAB_COPY.teach.question} ({LAB_COPY.teach.questionHelp})
                  </span>
                  <textarea id={ids.question} className="fl-area" maxLength={500} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
                </label>
                <label className="fl-field">
                  <span>{LAB_COPY.teach.bad}</span>
                  <input className="fl-input" maxLength={200} value={form.badExcerpt} onChange={(e) => setForm({ ...form, badExcerpt: e.target.value })} />
                </label>
                <label className="fl-field">
                  <span>{LAB_COPY.teach.better}</span>
                  <textarea className="fl-area" maxLength={1500} value={form.betterAnswer} onChange={(e) => setForm({ ...form, betterAnswer: e.target.value })} required />
                </label>
                <div className="fl-row">
                  <button type="submit" className="fl-btn fl-btn-primary" disabled={busy("correction") || form.question.trim().length < 8 || form.betterAnswer.trim().length < 5}>
                    {LAB_COPY.teach.save}
                  </button>
                </div>
              </form>

              <h3 className="fl-h2">{LAB_COPY.teach.listTitle}</h3>
              {state.corrections.length === 0 ? (
                <p className="fl-empty">{LAB_COPY.teach.empty}</p>
              ) : (
                <ul className="fl-list">
                  {state.corrections.map((c) => (
                    <CorrectionCard key={c.id} c={c} store={store} busy={busy(c.id)} noteBusy={busy("note-new")} noteOpen={noteOpen === c.id} onToggleNote={() => setNoteOpen(noteOpen === c.id ? null : c.id)} onDone={() => focusSoon(`${ids.teach}-h`)} />
                  ))}
                </ul>
              )}
            </section>

            {/* ---------------------------------------------------------------- exams */}
            <section className="fl-sec" id={ids.exams} aria-labelledby={`${ids.exams}-h`}>
              <h2 className="fl-h" id={`${ids.exams}-h`} tabIndex={-1}>
                {LAB_COPY.sections.exams}
              </h2>
              <p className="fl-banner" data-tone="exam" role="note">
                <strong>{LAB_COPY.exams.warnTitle}</strong>
                {LAB_COPY.exams.warn}
              </p>
              <div className="fl-sets">
                <ExamSetView set="training" items={state.training} store={store} busy={busy} noteOpen={noteOpen} setNoteOpen={setNoteOpen} headingId={`${ids.exams}-h`} />
                <ExamSetView set="held_out" items={state.heldOut} store={store} busy={busy} noteOpen={noteOpen} setNoteOpen={setNoteOpen} headingId={`${ids.exams}-h`} />
              </div>
            </section>

            {/* ---------------------------------------------------------------- notes */}
            <section className="fl-sec" id={ids.notes} aria-labelledby={`${ids.notes}-h`}>
              <h2 className="fl-h" id={`${ids.notes}-h`} tabIndex={-1}>
                {LAB_COPY.sections.notes}
              </h2>
              <p className="fl-hint">{LAB_COPY.notes.hint}</p>
              <h3 className="fl-h2">{LAB_COPY.notes.pending}</h3>
              {state.notes.filter((n) => n.status === "pending").length === 0 ? (
                <p className="fl-empty">{LAB_COPY.notes.empty}</p>
              ) : (
                <ul className="fl-list">
                  {state.notes
                    .filter((n) => n.status === "pending")
                    .map((n) => (
                      <NoteCard key={n.id} n={n} store={store} busy={busy(n.id)} onDone={() => focusSoon(`${ids.notes}-h`)} />
                    ))}
                </ul>
              )}
              {state.notes.some((n) => n.status !== "pending") ? (
                <details className="fl-more">
                  <summary>{LAB_COPY.notes.decided}</summary>
                  <ul className="fl-list" style={{ paddingBottom: 12 }}>
                    {state.notes
                      .filter((n) => n.status !== "pending")
                      .map((n) => (
                        <NoteCard key={n.id} n={n} store={store} busy={false} onDone={() => {}} />
                      ))}
                  </ul>
                </details>
              ) : null}
            </section>

            {/* ---------------------------------------------------------------- tests */}
            <section className="fl-sec" id={ids.tests} aria-labelledby={`${ids.tests}-h`}>
              <h2 className="fl-h" id={`${ids.tests}-h`} tabIndex={-1}>
                {LAB_COPY.sections.tests}
              </h2>
              <p className="fl-hint">{LAB_COPY.tests.hint}</p>
              <div className="fl-row">
                {(["guardrail", "orchestration"] as const).map((s) => (
                  <button key={s} type="button" className="fl-btn fl-btn-primary" disabled={busy(`eval:${s}`) || state.pending.length > 0 || !state.online} onClick={() => void store.requestEval(s, false)}>
                    {LAB_COPY.tests[s]}
                  </button>
                ))}
              </div>
              <details className="fl-more">
                <summary>{LAB_COPY.tests.longTitle}</summary>
                <p className="fl-hint" style={{ paddingBottom: 8 }}>
                  {LAB_COPY.tests.longWarn}
                </p>
                <label className="fl-check">
                  <input type="checkbox" checked={confirmLong} onChange={(e) => setConfirmLong(e.target.checked)} />
                  <span>{LAB_COPY.tests.longConfirm}</span>
                </label>
                <div className="fl-row">
                  {(["guardrail_model", "heldout", "domain", "persona"] as const).map((s) => (
                    <button key={s} type="button" className="fl-btn" disabled={!confirmLong || busy(`eval:${s}`) || state.pending.length > 0 || !state.online} onClick={() => void store.requestEval(s as EvalSuite, confirmLong)}>
                      {LAB_COPY.tests[s]}
                    </button>
                  ))}
                </div>
              </details>

              <h3 className="fl-h2">{LAB_COPY.tests.waiting}</h3>
              {state.pending.length === 0 ? (
                <p className="fl-hint">{LAB_COPY.tests.noPending}</p>
              ) : (
                <ul className="fl-list">
                  {state.pending.map((p) => (
                    <li className="fl-card" key={p.jobId}>
                      <span className="fl-chip" data-tone="warn">
                        {p.status === "queued" ? "Waiting" : "Running"}
                      </span>{" "}
                      {SUITE_NAMES[p.suite ?? ""] ?? p.suite ?? "Test"}
                    </li>
                  ))}
                </ul>
              )}

              {latestGuardrail && latestGuardrail.passed < latestGuardrail.total ? (
                <p className="fl-banner" data-tone="danger" role="alert">
                  <strong>{LAB_COPY.tests.blocked}</strong>
                </p>
              ) : latestGuardrail ? (
                <p className="fl-hint">{LAB_COPY.tests.guardrailOk}</p>
              ) : null}

              <h3 className="fl-h2">{LAB_COPY.tests.chartTitle}</h3>
              <p className="fl-hint">{LAB_COPY.tests.chartHint}</p>
              <div className="fl-chartgrid">
                {CHART_SUITES.map((s) => (
                  <PassChart key={s} id={`${uid}-chart-${s}`} suite={s} title={`${SUITE_NAMES[s]} pass rate`} points={seriesFor(state.runs, s, 10)} strict={s === "guardrail"} emptyText={LAB_COPY.tests.noRuns} />
                ))}
              </div>

              {sortedRuns.length > 0 ? (
                <div className="fl-tablewrap">
                  <table className="fl-table">
                    <caption>{LAB_COPY.tests.tableTitle}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{LAB_COPY.tests.cols.when}</th>
                        <th scope="col">{LAB_COPY.tests.cols.suite}</th>
                        <th scope="col">{LAB_COPY.tests.cols.passed}</th>
                        <th scope="col">{LAB_COPY.tests.cols.rate}</th>
                        <th scope="col">{LAB_COPY.tests.cols.range}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRuns.slice(0, 10).map((r) => {
                        const w = wilson(r.passed, r.total);
                        const missed = r.suite === "guardrail" && r.passed < r.total;
                        return (
                          <tr key={r.id}>
                            <td>
                              {shortDate(r.finishedAt ?? r.createdAt)} {shortTime(r.finishedAt ?? r.createdAt)}
                            </td>
                            <td>{SUITE_NAMES[r.suite] ?? r.suite}</td>
                            <td data-tone={missed ? "bad" : undefined}>
                              {r.passed} of {r.total}
                              {missed ? " BLOCKED" : ""}
                            </td>
                            <td>{r.total > 0 ? percent(w.rate) : "-"}</td>
                            <td>{r.total > 0 ? `${percent(w.low)} to ${percent(w.high)}` : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="fl-stat">
      <b>{value}</b> {label}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="fl-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// --------------------------------------------------------------------------------------------------------------- one correction

function CorrectionCard({ c, store, busy, noteBusy, noteOpen, onToggleNote, onDone }: { c: Correction; store: LabStore; busy: boolean; noteBusy: boolean; noteOpen: boolean; onToggleNote: () => void; onDone: () => void }) {
  const [suite, setSuite] = useState<ItemSuite>(kindDefaultSuite(c.kind));
  const [keywords, setKeywords] = useState("");
  const dismissed = c.status === "rejected";
  const blockTraining = c.examMade || c.practiceMade;
  const blockExam = c.examMade || c.practiceMade || c.noteMade;
  const why = c.examMade ? LAB_COPY.teach.examBlocksTraining : c.practiceMade ? LAB_COPY.teach.trainingBlocksExam : c.noteMade ? LAB_COPY.teach.noteBlocksExam : "";
  const q = trim(c.question, 40);

  async function promote(set: "training" | "held_out") {
    const ok = await store.promote(c.id, set, suite, keywords);
    if (ok) onDone();
  }

  return (
    <li className="fl-card">
      <div className="fl-row" style={{ marginTop: 0 }}>
        <span className="fl-chip">{LAB_COPY.teach.kinds[c.kind]}</span>
        <span className="fl-chip" data-tone={dismissed ? "warn" : undefined}>
          {LAB_COPY.teach.status[c.status]}
        </span>
        {c.practiceMade ? <span className="fl-chip" data-tone="good">{LAB_COPY.teach.madeTraining}</span> : null}
        {c.examMade ? <span className="fl-chip" data-tone="warn">{LAB_COPY.teach.madeExam}</span> : null}
        {c.noteMade ? <span className="fl-chip">{LAB_COPY.teach.madeNote}</span> : null}
        <span className="fl-small">{shortDate(c.createdAt)}</span>
      </div>
      <p className="fl-q">{c.question}</p>
      {c.badExcerpt ? <p className="fl-meta">Faye said: {c.badExcerpt}</p> : null}
      <p className="fl-meta">Right answer: {c.betterAnswer}</p>

      {!dismissed ? (
        <details className="fl-more">
          <summary aria-label={`${LAB_COPY.teach.use}: ${q}`}>{LAB_COPY.teach.use}</summary>
          <div className="fl-form">
            <Field label={LAB_COPY.teach.suite}>
              <select className="fl-select" value={suite} onChange={(e) => setSuite(e.target.value as ItemSuite)}>
                {ITEM_SUITES.map((s) => (
                  <option key={s} value={s}>
                    {LAB_COPY.teach.suites[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={LAB_COPY.teach.keywords}>
              <input className="fl-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-describedby={`${c.id}-kwh`} />
            </Field>
            <p className="fl-small" id={`${c.id}-kwh`}>
              {LAB_COPY.teach.keywordsHelp}
            </p>
            {why ? <p className="fl-hint">{why}</p> : null}
            <div className="fl-row">
              <button type="button" className="fl-btn" disabled={busy || blockTraining} onClick={() => void promote("training")} aria-label={`${LAB_COPY.teach.makeTraining}: ${q}`}>
                {LAB_COPY.teach.makeTraining}
              </button>
              <button type="button" className="fl-btn fl-btn-exam" disabled={busy || blockExam} onClick={() => void promote("held_out")} aria-label={`${LAB_COPY.teach.makeExam}: ${q}`}>
                {LAB_COPY.teach.makeExam}
              </button>
            </div>
          </div>
        </details>
      ) : null}

      <div className="fl-row">
        {!dismissed && !c.examMade ? (
          <button type="button" className="fl-btn" aria-expanded={noteOpen} disabled={busy} onClick={onToggleNote} aria-label={`${LAB_COPY.teach.makeNote}: ${q}`}>
            {LAB_COPY.teach.makeNote}
          </button>
        ) : null}
        {!dismissed && c.status === "new" ? (
          <button type="button" className="fl-btn" disabled={busy} onClick={async () => { if (await store.dismissCorrection(c.id)) onDone(); }} aria-label={`${LAB_COPY.teach.dismiss}: ${q}`}>
            {LAB_COPY.teach.dismiss}
          </button>
        ) : null}
        {dismissed ? (
          <button type="button" className="fl-btn" disabled={busy} onClick={() => void store.reopenCorrection(c.id)} aria-label={`${LAB_COPY.teach.reopen}: ${q}`}>
            {LAB_COPY.teach.reopen}
          </button>
        ) : null}
      </div>
      {c.examMade ? <p className="fl-never">{LAB_COPY.teach.examBlocksNote}</p> : null}
      {noteOpen && !c.examMade ? (
        <NoteComposer
          busy={noteBusy}
          initialTitle={trim(c.question, 70)}
          initialBody={c.betterAnswer}
          idPrefix={c.id}
          onCancel={onToggleNote}
          onSubmit={async (title, body) => {
            const ok = await store.proposeNote({ correctionId: c.id, title, body });
            if (ok) onToggleNote();
          }}
        />
      ) : null}
    </li>
  );
}

function NoteComposer({ busy, initialTitle, initialBody, idPrefix, onSubmit, onCancel }: { busy: boolean; initialTitle: string; initialBody: string; idPrefix: string; onSubmit: (title: string, body: string) => void | Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      className="fl-form"
      style={{ marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(title, body);
      }}
    >
      <label className="fl-field">
        <span>{LAB_COPY.notes.formTitle}</span>
        <input ref={ref} className="fl-input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      <label className="fl-field">
        <span>{LAB_COPY.notes.formBody}</span>
        <textarea className="fl-area" maxLength={1500} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby={`${idPrefix}-nh`} required />
      </label>
      <p className="fl-small" id={`${idPrefix}-nh`}>
        {LAB_COPY.notes.formHelp}
      </p>
      <div className="fl-row">
        <button type="submit" className="fl-btn fl-btn-primary" disabled={busy || title.trim().length < 3 || body.trim().length < 20}>
          {LAB_COPY.notes.send}
        </button>
        <button type="button" className="fl-btn" onClick={onCancel}>
          {LAB_COPY.notes.cancel}
        </button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------------------------------------------- exams

function ExamSetView({ set, items, store, busy, noteOpen, setNoteOpen, headingId }: { set: "training" | "held_out"; items: ExamItem[]; store: LabStore; busy: (k: string) => boolean; noteOpen: string | null; setNoteOpen: (id: string | null) => void; headingId: string }) {
  const copy = set === "training" ? LAB_COPY.exams.training : LAB_COPY.exams.heldOut;
  return (
    <div className="fl-set" data-set={set} role="group" aria-label={`${copy.badge}, ${items.length}`}>
      <span className="fl-badge">{copy.badge}</span>
      <p className="fl-hint">
        {copy.sub} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="fl-empty">{LAB_COPY.exams.empty}</p>
      ) : (
        <ul className="fl-list">
          {items.map((i) => (
            <ExamCard key={i.id} item={i} store={store} busy={busy(i.id)} noteBusy={busy("note-new")} noteOpen={noteOpen === i.id} onToggleNote={() => setNoteOpen(noteOpen === i.id ? null : i.id)} headingId={headingId} />
          ))}
        </ul>
      )}
      {set === "held_out" ? <p className="fl-never">{LAB_COPY.exams.neverNote}</p> : null}
    </div>
  );
}

function ExamCard({ item, store, busy, noteBusy, noteOpen, onToggleNote, headingId }: { item: ExamItem; store: LabStore; busy: boolean; noteBusy: boolean; noteOpen: boolean; onToggleNote: () => void; headingId: string }) {
  const [confirming, setConfirming] = useState(false);
  const q = trim(item.question, 40);
  return (
    <li className="fl-card">
      <div className="fl-row" style={{ marginTop: 0 }}>
        <span className="fl-chip">{LAB_COPY.teach.suites[item.suite] ?? item.suite}</span>
        <span className="fl-chip" data-tone={item.approved ? "good" : "warn"}>
          {item.approved ? LAB_COPY.exams.inUse : LAB_COPY.exams.paused}
        </span>
        {item.usedInCorpus ? <span className="fl-chip">{LAB_COPY.exams.usedInNotes}</span> : null}
      </div>
      <p className="fl-q">{item.question}</p>
      {item.requiredKeywords.length > 0 ? (
        <p className="fl-meta">
          {LAB_COPY.exams.words}: {item.requiredKeywords.join(", ")}
        </p>
      ) : null}
      <div className="fl-row">
        <button type="button" className="fl-btn" disabled={busy} onClick={() => void store.examAction(item.id, item.approved ? "pause" : "resume")} aria-label={`${item.approved ? LAB_COPY.exams.pause : LAB_COPY.exams.resume}: ${q}`}>
          {item.approved ? LAB_COPY.exams.pause : LAB_COPY.exams.resume}
        </button>
        {item.set === "training" ? (
          <button type="button" className="fl-btn" aria-expanded={noteOpen} disabled={busy} onClick={onToggleNote} aria-label={`${LAB_COPY.exams.makeNote}: ${q}`}>
            {LAB_COPY.exams.makeNote}
          </button>
        ) : null}
        {confirming ? (
          <>
            <button
              type="button"
              className="fl-btn fl-btn-danger"
              disabled={busy}
              onClick={async () => {
                const ok = await store.examAction(item.id, "delete");
                if (ok) focusSoon(headingId);
                else setConfirming(false);
              }}
              aria-label={`${LAB_COPY.exams.confirmDelete}: ${q}`}
            >
              {LAB_COPY.exams.confirmDelete}
            </button>
            <button type="button" className="fl-btn" onClick={() => setConfirming(false)}>
              {LAB_COPY.exams.cancel}
            </button>
          </>
        ) : (
          <button type="button" className="fl-btn fl-btn-danger" disabled={busy} onClick={() => setConfirming(true)} aria-label={`${LAB_COPY.exams.del}: ${q}`}>
            {LAB_COPY.exams.del}
          </button>
        )}
      </div>
      {noteOpen && item.set === "training" ? (
        <NoteComposer
          busy={noteBusy}
          initialTitle={trim(item.question, 70)}
          initialBody=""
          idPrefix={item.id}
          onCancel={onToggleNote}
          onSubmit={async (title, body) => {
            const ok = await store.proposeNote({ examId: item.id, title, body });
            if (ok) onToggleNote();
          }}
        />
      ) : null}
    </li>
  );
}

// --------------------------------------------------------------------------------------------------------------- notes

function NoteCard({ n, store, busy, onDone }: { n: CorpusNote; store: LabStore; busy: boolean; onDone: () => void }) {
  const pending = n.status === "pending";
  return (
    <li className="fl-card">
      <div className="fl-row" style={{ marginTop: 0 }}>
        <span className="fl-chip" data-tone={n.status === "approved" ? "good" : n.status === "rejected" ? "warn" : undefined}>
          {LAB_COPY.notes.status[n.status]}
        </span>
        {n.fromEvalItemId ? <span className="fl-chip">{LAB_COPY.notes.fromTraining}</span> : null}
        {n.fromCorrectionId ? <span className="fl-chip">{LAB_COPY.notes.fromCorrection}</span> : null}
        <span className="fl-small">{shortDate(n.createdAt)}</span>
      </div>
      <p className="fl-q">{n.title}</p>
      <p className="fl-meta">{n.body}</p>
      {pending ? (
        <div className="fl-row">
          <button type="button" className="fl-btn fl-btn-primary" disabled={busy} onClick={async () => { if (await store.decideNote(n.id, "approve")) onDone(); }} aria-label={`${LAB_COPY.notes.approve}: ${trim(n.title, 40)}`}>
            {LAB_COPY.notes.approve}
          </button>
          <button type="button" className="fl-btn" disabled={busy} onClick={async () => { if (await store.decideNote(n.id, "reject")) onDone(); }} aria-label={`${LAB_COPY.notes.reject}: ${trim(n.title, 40)}`}>
            {LAB_COPY.notes.reject}
          </button>
        </div>
      ) : null}
    </li>
  );
}
