import type { ReactNode } from "react";

/**
 * Shared disclosure for every results tab (study, backtest, signal, options, portfolio). One place for the wording so
 * every tab says the same thing: where the data came from and as of when, that this is research and education and not
 * advice, that past performance and backtested or hypothetical results do not predict future results, and, where it
 * applies, how many observations the result rests on and how many things were tested.
 *
 * Jarvis styling (jv-card) so it matches the rest of the app.
 */

function fmtAsOf(asOf: number | string | Date | null | undefined): string | null {
  if (asOf === null || asOf === undefined || asOf === "") return null;
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

export interface ResearchNoticeProps {
  /** Where the data comes from, for example "Alpaca IEX daily bars". */
  source?: string;
  /** When the data is as of (epoch ms, ISO string or Date). Shown in Eastern time. */
  asOf?: number | string | Date | null;
  /** True when the data is known to be delayed. */
  delayed?: boolean;
  /** Number of observations (trades, days, events) the headline result rests on. */
  sampleSize?: number | null;
  /** How many hypotheses, signals or horizons were tested together; shows the multiple-testing caveat when above 1. */
  testsRun?: number | null;
  /** Set for backtests and other hypothetical results (adds the hypothetical-performance sentence). */
  hypothetical?: boolean;
  /** Any extra sentence (a study-specific caveat). */
  children?: ReactNode;
}

export function PaperBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`jv-badge c-signal ${className}`.trim()} title="Paper trading: simulated orders with no real money" data-testid="paper-badge">
      Paper trading: simulated, no real money
    </span>
  );
}

export function ResearchNotice({ source, asOf, delayed, sampleSize, testsRun, hypothetical = true, children }: ResearchNoticeProps) {
  const asOfText = fmtAsOf(asOf);
  return (
    <aside className="jv-card" style={{ borderColor: "var(--line-bright)" }} aria-label="Research notice" data-testid="research-notice">
      <p className="text-xs" style={{ color: "var(--text-1)", margin: 0 }}>
        <strong style={{ color: "var(--text-0)" }}>Research and education, not advice.</strong> This is not personalized investment advice and not a
        recommendation to buy or sell anything.
        {hypothetical && " Backtested and hypothetical results were not produced by real trading and have no real fills, fees or taxes."}{" "}
        Past performance does not predict future results.
      </p>
      <p className="text-xs" style={{ color: "var(--text-2)", margin: "6px 0 0" }}>
        {source ? `Data: ${source}. ` : ""}
        {asOfText
          ? `As of ${asOfText}. `
          : "Data is pulled when you run this view and is as of the latest completed bar the data source returned; it is not a live feed. "}
        {delayed ? "Some prices are delayed. " : "Prices may be delayed. "}
      </p>
      {(typeof sampleSize === "number" || (typeof testsRun === "number" && testsRun > 1)) && (
        <p className="text-xs" style={{ color: "var(--text-2)", margin: "6px 0 0" }}>
          {typeof sampleSize === "number" ? `Based on ${sampleSize} observation${sampleSize === 1 ? "" : "s"}; small samples are unreliable. ` : ""}
          {typeof testsRun === "number" && testsRun > 1
            ? `${testsRun} things were tested together, so some will look significant by chance alone; the significance shown is adjusted for that (false-discovery-rate control).`
            : ""}
        </p>
      )}
      {children && (
        <p className="text-xs" style={{ color: "var(--text-2)", margin: "6px 0 0" }}>
          {children}
        </p>
      )}
    </aside>
  );
}

export default ResearchNotice;
