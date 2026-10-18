"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ResearchNotice } from "./ResearchNotice";
import { holdingMeaning } from "@/lib/client-research/meaning";
import type {
  CatalystView,
  CryptoRegimeView,
  HoldingResearch,
  MethodExplainer,
  OutlookView,
  ResearchEnvironment,
  ResearchHoldingRef,
  ResearchIndex,
  ScorecardSummary,
} from "@/lib/client-research/types";

/**
 * The client's Research section: the advisor-side valuation and environment research, read-only and in plain words.
 * Everything here comes from /api/client/[slug]/research/*, which only ever looks at this client's own holdings.
 *
 * Writing rules for this file: reading grade 8 or lower; no "buy", "sell", "cheap" or "attractive" labels; every number
 * shows where it came from and as of when; a missing number is shown as missing, never as zero.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

async function getJson<T>(url: string, signal: AbortSignal, onExpired?: () => void): Promise<Load<T>> {
  try {
    const res = await fetch(url, { signal });
    if (res.status === 401) {
      onExpired?.();
      return { state: "error", message: "Your session ended. Enter your passcode again." };
    }
    if (res.status === 429) return { state: "error", message: "Too many requests. Wait a few minutes and reload." };
    if (!res.ok) return { state: "error", message: "This part is not available right now." };
    return { state: "ready", data: (await res.json()) as T };
  } catch {
    return { state: "error", message: "This part is not available right now." };
  }
}

const ET: Intl.DateTimeFormatOptions = { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
function fmtEt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleString("en-US", ET)} ET` : null;
}
function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : day;
}
const fmtX = (n: number) => `${n.toFixed(1)}x`;
const fmtSigned = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(0)}%`;
const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "signal" | "danger"; title?: string }) {
  return (
    <span className={`jv-badge c-${tone}`} title={title}>
      {children}
    </span>
  );
}

function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div>
        <div className="jv-eyebrow">{eyebrow}</div>
        <h2 id={id} className="jv-title" style={{ marginBottom: 6 }}>
          {title}
        </h2>
        {intro && (
          <p className="text-sm" style={{ color: "var(--text-1)", margin: 0, maxWidth: "72ch", lineHeight: 1.6 }}>
            {intro}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs" style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <div className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
      <p className="text-xs" style={{ color: "var(--verdict)", margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- holdings

function HoldingCard({ card }: { card: HoldingResearch }) {
  const { phaseLine, valuationLine } = holdingMeaning(card);
  const v = card.valuation;
  const price = card.price;
  const priceAt = fmtEt(price?.asOf);
  return (
    <article className="jv-card flex flex-col gap-3" aria-label={`${card.symbol} research`} data-testid={`holding-${card.symbol}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-0)", margin: 0 }}>
          {card.symbol}
        </h3>
        {card.company && <span className="text-sm" style={{ color: "var(--text-1)" }}>{card.company}</span>}
        {card.phase && <Badge tone="signal">Phase {card.phase.number}: {card.phase.name}</Badge>}
        <Badge title="Worked out by a fixed rule from public data. It can be wrong and it is not a promise.">Estimate</Badge>
        {price?.delayed && <Badge tone="danger">Delayed price</Badge>}
        {card.stale && <Badge tone="danger" title="A new fetch failed, so the last good result is shown.">Older result</Badge>}
      </div>

      <p className="text-sm" style={{ color: "var(--text-0)", margin: 0, lineHeight: 1.6 }} data-testid={`meaning-${card.symbol}`}>
        {valuationLine}
      </p>
      {phaseLine && <Muted>{phaseLine}</Muted>}
      {card.phase?.note && <Muted>{card.phase.note}</Muted>}
      {card.phase && card.phase.confidence !== "high" && card.phase.confidence !== "unknown" && (
        <Muted>How sure we are of this phase: {card.phase.confidence}. The company sits near the line between phases.</Muted>
      )}

      {v && v.measures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="jv-table">
            <thead>
              <tr>
                <th>Measure</th>
                <th className="text-right">Now</th>
                <th className="text-right">Own average, {v.window.replace("the ", "")}</th>
                <th className="text-right">Difference</th>
                <th>Where it sits</th>
              </tr>
            </thead>
            <tbody>
              {v.measures.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td className="jv-num">{fmtX(m.current)}</td>
                  <td className="jv-num">{fmtX(m.average)}</td>
                  <td className="jv-num">{fmtSigned(m.premiumPct)}</td>
                  <td style={{ color: "var(--text-1)" }}>{m.position} its own average</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v?.priceAssumes && (
        <Muted>
          What the price expects: about {v.priceAssumes.growthPctPerYear.toFixed(0)}% a year of cash-flow growth for {v.priceAssumes.years} years.
          {v.priceAssumes.currentCashFlowGrowthPct !== null ? ` Over the last 12 months the company’s cash flow grew ${v.priceAssumes.currentCashFlowGrowthPct.toFixed(0)}%.` : " We could not work out the recent growth."}
        </Muted>
      )}

      {v && (v.otherThings.length > 0 || v.assumptions.length > 0) && (
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: "var(--text-1)" }}>
            Other things to know
          </summary>
          <ul className="flex flex-col gap-2 mt-2" style={{ paddingLeft: 16, listStyle: "disc" }}>
            {v.otherThings.map((o) => (
              <li key={o.title} className="text-xs" style={{ color: "var(--text-1)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-0)" }}>{o.title}.</strong> {o.detail}
              </li>
            ))}
            {v.assumptions.map((a) => (
              <li key={a.slice(0, 40)} className="text-xs" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
                {a}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Muted>
        {card.filingsAsOf ? `Company filings through ${card.filingsAsOf}. ` : ""}
        {price
          ? `Price ${fmtUsd(price.value)}${priceAt ? ` as of ${priceAt}` : " (the data source gave no time)"}${price.delayed ? ", delayed" : ""}. `
          : "No price shown. "}
        Checked {fmtEt(card.fetchedAt) ?? "recently"}.
        {card.sources.length > 0 ? ` Sources: ${card.sources.join("; ")}.` : ""}
      </Muted>
    </article>
  );
}

function HoldingsSection({ index, cards }: { index: Load<ResearchIndex>; cards: Record<string, Load<HoldingResearch>> }) {
  return (
    <Section
      id="research-holdings"
      eyebrow="Your holdings"
      title="Your holdings, valued"
      intro="For each stock you hold: what stage the business is in, and how today's price compares with that company's own average for the past year. This describes the past. It does not say what the price will do next."
    >
      {index.state === "loading" && <Muted>Loading your holdings…</Muted>}
      {index.state === "error" && <Problem>{index.message}</Problem>}
      {index.state === "ready" && index.data.holdings.length === 0 && <Muted>No holdings are on file yet, so there is nothing to value.</Muted>}
      {index.state === "ready" &&
        index.data.holdings
          .filter((h: ResearchHoldingRef) => h.researchable)
          .map((h) => {
            const c = cards[h.symbol];
            if (!c || c.state === "loading") {
              return (
                <div key={h.symbol} className="jv-card">
                  <Muted>Reading the filings for {h.symbol}… This can take up to a minute.</Muted>
                </div>
              );
            }
            if (c.state === "error") {
              return (
                <div key={h.symbol} className="jv-card">
                  <Muted>
                    {h.symbol}: {c.message}
                  </Muted>
                </div>
              );
            }
            return <HoldingCard key={h.symbol} card={c.data} />;
          })}
      {index.state === "ready" && index.data.holdings.some((h) => !h.researchable) && (
        <div className="jv-card">
          <div className="jv-strip-title">Not valued here</div>
          <ul className="flex flex-col gap-1" style={{ paddingLeft: 16, listStyle: "disc" }}>
            {index.data.holdings
              .filter((h) => !h.researchable)
              .map((h) => (
                <li key={`${h.assetClass}-${h.symbol}`} className="text-xs" style={{ color: "var(--text-1)" }}>
                  <strong style={{ color: "var(--text-0)" }}>{h.symbol}</strong> ({h.assetClassLabel}): {h.reason}
                </li>
              ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- environment

function OutlookBlock({ o }: { o: OutlookView }) {
  return (
    <div className="jv-card flex flex-col gap-3" data-testid="outlook">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-0)", margin: 0 }}>
          Economic outlook
        </h3>
        <Badge tone="signal">{o.regime.label}</Badge>
        <Badge>Estimate</Badge>
      </div>
      <Muted>
        As of {o.asOfDate}. Next planned update: {o.nextScheduledRefresh}. Where the economy sits in its cycle: {o.regime.cyclePhase}. Money conditions: {o.regime.financialConditions}.
      </Muted>
      {o.glance && (
        <p className="text-sm" style={{ color: "var(--text-0)", margin: 0, lineHeight: 1.6 }}>
          {o.glance}
        </p>
      )}
      {o.regime.dualMandateBalance && <Muted>{o.regime.dualMandateBalance}</Muted>}

      <div className="overflow-x-auto">
        <table className="jv-table">
          <thead>
            <tr>
              <th>Reading</th>
              <th>Latest</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {o.indicators.map((i) => (
              <tr key={i.indicator} title={i.role}>
                <td>{i.indicator}</td>
                <td style={{ color: "var(--text-1)" }}>{i.currentReading}</td>
                <td style={{ color: "var(--text-2)" }}>{i.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="jv-strip-title">Interest rates</div>
        <Muted>
          Rate now: {o.policy.currentTargetRange}. Where the market prices rates: {o.policy.marketImpliedPath}. Our own estimate of the path: {o.policy.houseViewPath}. That last one is a forecast. It is not a promise and it can be wrong.
        </Muted>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RiskList title="What could go better than expected" items={o.upsideRisks} />
        <RiskList title="What could go worse than expected" items={o.downsideRisks} />
      </div>

      {o.dataLimitations.length > 0 && (
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: "var(--text-1)" }}>
            What this outlook cannot tell you
          </summary>
          <ul className="flex flex-col gap-1 mt-2" style={{ paddingLeft: 16, listStyle: "disc" }}>
            {o.dataLimitations.map((d) => (
              <li key={d.slice(0, 40)} className="text-xs" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
                {d}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RiskList({ title, items }: { title: string; items: OutlookView["upsideRisks"] }) {
  return (
    <div>
      <div className="jv-strip-title">{title}</div>
      {items.length === 0 ? (
        <Muted>None listed.</Muted>
      ) : (
        <ul className="flex flex-col gap-2" style={{ paddingLeft: 16, listStyle: "disc" }}>
          {items.map((r) => (
            <li key={r.scenario.slice(0, 50)} className="text-xs" style={{ color: "var(--text-1)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text-0)" }}>{r.scenario}</strong> Sign to watch: {r.trigger} If it happens: {r.marketImplication}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalystsBlock({ c }: { c: NonNullable<ResearchEnvironment["catalysts"]> }) {
  return (
    <div className="jv-card flex flex-col gap-3" data-testid="catalysts">
      <h3 className="text-base font-semibold" style={{ color: "var(--text-0)", margin: 0 }}>
        Coming up in the next 30 days
      </h3>
      <Muted>{c.scope}</Muted>
      {c.events.length === 0 ? (
        <Muted>No listed event in this window. That does not mean nothing will happen.</Muted>
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {c.events.map((e: CatalystView) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="jv-num" style={{ color: "var(--text-1)", minWidth: 110, fontFamily: "var(--font-mono)" }}>
                {fmtDay(e.date)}
                {e.time ? ` ${e.time}` : ""}
              </span>
              <span style={{ color: "var(--text-0)" }}>{e.name}</span>
              <Badge tone={e.impact === "high" ? "signal" : "neutral"}>{e.impact} impact</Badge>
              {e.appliesTo.length > 0 && <span className="text-xs" style={{ color: "var(--text-2)" }}>Matters for: {e.appliesTo.slice(0, 6).join(", ")}</span>}
              {e.sourceUrl && (
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline" style={{ color: "var(--text-1)" }}>
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <Muted>
        Dates were read from the official publishers on {c.verifiedOn} and can change. {c.notes.join(" ")}
      </Muted>
    </div>
  );
}

function CryptoBlock({ r }: { r: CryptoRegimeView }) {
  return (
    <div className="jv-card flex flex-col gap-3" data-testid="crypto-regime">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-0)", margin: 0 }}>
          Crypto market read
        </h3>
        <Badge tone="signal">
          {r.met} of {r.total} conditions met
        </Badge>
        <Badge>Estimate</Badge>
      </div>
      <p className="text-sm" style={{ color: "var(--text-0)", margin: 0 }}>
        {r.labelPlain}
      </p>
      <div className="overflow-x-auto">
        <table className="jv-table">
          <thead>
            <tr>
              <th>Condition</th>
              <th>Rule</th>
              <th className="text-right">Reading</th>
              <th>Met?</th>
            </tr>
          </thead>
          <tbody>
            {r.checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td style={{ color: "var(--text-2)" }}>{c.threshold}</td>
                <td className="jv-num">{c.reading}</td>
                <td style={{ color: c.status === "unavailable" ? "var(--verdict)" : "var(--text-1)" }}>{c.status === "met" ? "Yes" : c.status === "not-met" ? "No" : "Not available"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Muted>
        As of {fmtEt(r.asOf) ?? "recently"}. Sources: {r.sources.map((s) => `${s.label} (${s.source}, ${s.status})`).join("; ")}.
      </Muted>
      {r.limitations.map((l) => (
        <Muted key={l.slice(0, 40)}>{l}</Muted>
      ))}
    </div>
  );
}

function EnvironmentSection({ env, holdsCrypto }: { env: Load<ResearchEnvironment>; holdsCrypto: boolean }) {
  return (
    <Section
      id="research-environment"
      eyebrow="The market around you"
      title="The environment"
      intro="The economy, the dates that can move markets, and, if you hold crypto, a market-wide read of crypto. This is the backdrop for your holdings."
    >
      {env.state === "loading" && <Muted>Loading the outlook…</Muted>}
      {env.state === "error" && <Problem>{env.message}</Problem>}
      {env.state === "ready" && (
        <>
          {env.data.stale && <Problem>Some of this is the last good copy, because a fresh read failed. Check the dates below.</Problem>}
          {env.data.outlook ? <OutlookBlock o={env.data.outlook} /> : <Problem>{env.data.outlookNote}</Problem>}
          {env.data.catalysts && <CatalystsBlock c={env.data.catalysts} />}
          {holdsCrypto && (env.data.crypto ? <CryptoBlock r={env.data.crypto} /> : <Problem>{env.data.cryptoNote ?? "The crypto read is not available right now."}</Problem>)}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- method

function MethodSection({ method }: { method: Load<MethodExplainer> }) {
  return (
    <Section
      id="research-method"
      eyebrow="How we work"
      title="How we value things"
      intro="The steps are the same for every company. The rules are written down and the numbers can be checked."
    >
      {method.state === "loading" && <Muted>Loading…</Muted>}
      {method.state === "error" && <Problem>{method.message}</Problem>}
      {method.state === "ready" && (
        <div className="jv-card flex flex-col gap-4" data-testid="method">
          <ol className="flex flex-col gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {method.data.steps.map((s) => (
              <li key={s.title} className="text-sm" style={{ color: "var(--text-1)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-0)" }}>{s.title}.</strong> {s.body}
              </li>
            ))}
          </ol>

          <div>
            <div className="jv-strip-title">The five business phases</div>
            <ul className="flex flex-col gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {method.data.phases.map((p) => (
                <li key={p.number} className="text-xs" style={{ color: "var(--text-1)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-0)" }}>
                    {p.number}. {p.name}.
                  </strong>{" "}
                  {p.plain}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="jv-strip-title">What &ldquo;where it sits&rdquo; means</div>
            <ul className="flex flex-col gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {method.data.positions.map((p) => (
                <li key={p.label} className="text-xs" style={{ color: "var(--text-1)" }}>
                  <strong style={{ color: "var(--text-0)" }}>{p.label}:</strong> {p.rule}
                </li>
              ))}
            </ul>
            <Muted>These words only compare today with the past year. They are not a view on whether to buy or sell.</Muted>
          </div>

          <details>
            <summary className="text-xs cursor-pointer" style={{ color: "var(--text-1)" }}>
              Classic formulas our analysts also use
            </summary>
            <ul className="flex flex-col gap-2 mt-2" style={{ paddingLeft: 16, listStyle: "disc" }}>
              {method.data.methods.map((m) => (
                <li key={m.name} className="text-xs" style={{ color: "var(--text-1)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-0)" }}>{m.name}.</strong> {m.plain} <span style={{ color: "var(--text-2)" }}>Assumes: {m.assumes}</span>
                </li>
              ))}
            </ul>
          </details>

          <details>
            <summary className="text-xs cursor-pointer" style={{ color: "var(--text-1)" }}>
              Words we use
            </summary>
            <dl className="flex flex-col gap-2 mt-2">
              {method.data.words.map((w) => (
                <div key={w.term}>
                  <dt className="text-xs font-semibold" style={{ color: "var(--text-0)" }}>
                    {w.term}
                  </dt>
                  <dd className="text-xs" style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.6 }}>
                    {w.plain}
                    {w.fullDefinition && (
                      <details>
                        <summary className="cursor-pointer" style={{ color: "var(--text-2)" }}>
                          Full definition
                        </summary>
                        <span style={{ color: "var(--text-2)" }}>{w.fullDefinition}</span>
                      </details>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- forecasting note

function trackRecord(s: ScorecardSummary): string {
  if (s.graded === 0) return `We have logged ${s.logged} outlook call${s.logged === 1 ? "" : "s"}, and none has been graded yet. There is no track record to show, so treat the outlook as untested.`;
  const regime = s.regimeRight + s.regimeWrong;
  const path = s.pathRight + s.pathWrong;
  return `We have logged ${s.logged} outlook call${s.logged === 1 ? "" : "s"} and graded ${s.graded}. On the regime label, ${s.regimeRight} of ${regime} graded were right. On the rate path, ${s.pathRight} of ${path} were right. Counts this small say very little about how good the calls will be.`;
}

function ForecastNote({ env, method }: { env: Load<ResearchEnvironment>; method: Load<MethodExplainer> }) {
  return (
    <Section id="research-forecast" eyebrow="Read this first" title="A note on forecasts">
      <div className="jv-card flex flex-col gap-3" data-testid="forecast-note">
        <p className="text-sm" style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.6 }}>
          A forecast is a best guess made today from public data and a fixed rule. The world changes, so forecasts are often wrong, and a wide range of outcomes is always possible. Nothing on this page is a promise, a guarantee or a prediction you should rely on.
        </p>
        <p className="text-sm" style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.6 }}>
          The valuation comparisons above are not forecasts. They compare today with the past year. We do not keep a scorecard for them yet. The interest-rate path and the economic regime in the outlook are forecasts, and we log each one so it can be graded later.
        </p>
        {env.state === "ready" && env.data.scorecard && (
          <p className="text-sm" style={{ color: "var(--text-0)", margin: 0, lineHeight: 1.6 }} data-testid="track-record">
            {trackRecord(env.data.scorecard)}
          </p>
        )}
        {env.state === "ready" && !env.data.scorecard && <Muted>{env.data.scorecardNote ?? "The track record is not available right now."}</Muted>}
        {method.state === "ready" && method.data.limits.length > 0 && (
          <ul className="flex flex-col gap-1" style={{ paddingLeft: 16, listStyle: "disc" }}>
            {method.data.limits.map((l) => (
              <li key={l.slice(0, 40)} className="text-xs" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
                {l}
              </li>
            ))}
          </ul>
        )}
        {method.state === "ready" && method.data.open.length > 0 && (
          <div>
            <div className="jv-strip-title">Not built yet</div>
            <ul className="flex flex-col gap-1" style={{ paddingLeft: 16, listStyle: "disc" }}>
              {method.data.open.map((l) => (
                <li key={l.slice(0, 40)} className="text-xs" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- root

export function ClientResearchView({ slug, onSessionExpired }: { slug: string; onSessionExpired?: () => void }) {
  const [index, setIndex] = useState<Load<ResearchIndex>>({ state: "loading" });
  const [cards, setCards] = useState<Record<string, Load<HoldingResearch>>>({});
  const [env, setEnv] = useState<Load<ResearchEnvironment>>({ state: "loading" });
  const [method, setMethod] = useState<Load<MethodExplainer>>({ state: "loading" });
  // Kept in a ref so a parent that passes a new function on every render does not restart the loading.
  const expiredRef = useRef(onSessionExpired);
  useEffect(() => {
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    const ctl = new AbortController();
    const onExpired = () => expiredRef.current?.();
    const base = `/api/client/${encodeURIComponent(slug)}/research`;
    (async () => {
      void getJson<ResearchEnvironment>(`${base}/environment`, ctl.signal, onExpired).then((r) => !ctl.signal.aborted && setEnv(r));
      void getJson<MethodExplainer>(`${base}/method`, ctl.signal, onExpired).then((r) => !ctl.signal.aborted && setMethod(r));
      const idx = await getJson<ResearchIndex>(base, ctl.signal, onExpired);
      if (ctl.signal.aborted) return;
      setIndex(idx);
      if (idx.state !== "ready") return;
      // Two at a time: each stock can mean a filings read, so this keeps the load on the server small.
      const queue = idx.data.holdings.filter((h) => h.researchable).map((h) => h.symbol);
      const worker = async () => {
        for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
          const r = await getJson<HoldingResearch>(`${base}/holding/${encodeURIComponent(s)}`, ctl.signal, onExpired);
          if (ctl.signal.aborted) return;
          setCards((prev) => ({ ...prev, [s]: r }));
        }
      };
      await Promise.all([worker(), worker()]);
    })();
    return () => ctl.abort();
  }, [slug]);

  const holdsCrypto = index.state === "ready" && index.data.holdsCrypto;

  return (
    <div className="flex flex-col gap-10" data-testid="client-research">
      <div>
        <div className="jv-eyebrow">Research</div>
        <h2 className="jv-title">What we know about your holdings and the market</h2>
        <p className="text-sm" style={{ color: "var(--text-1)", margin: 0, maxWidth: "72ch", lineHeight: 1.6 }}>
          This page is read-only. It uses public filings and market data and explains each result in plain words. It is general research. It does not know your goals, your taxes or your other savings.
        </p>
      </div>

      <ResearchNotice
        source="SEC company filings, a market-data provider, FRED, and public crypto data"
        asOf={index.state === "ready" ? index.data.asOf : undefined}
        hypothetical={false}
      >
        Each result shows its own source and time. Estimates come from fixed rules and public data. They can be wrong and they are not promises.
      </ResearchNotice>

      <HoldingsSection index={index} cards={cards} />
      <EnvironmentSection env={env} holdsCrypto={holdsCrypto} />
      <MethodSection method={method} />
      <ForecastNote env={env} method={method} />
    </div>
  );
}
