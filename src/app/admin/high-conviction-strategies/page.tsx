import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getHighConvictionStrategies } from "@/lib/agents/trading-agent/skills/high-conviction-strategies";
import { OptionScenarioPanel } from "@/components/OptionScenarioPanel";
import type { HighConvictionStrategy } from "@/lib/agents/trading-agent/types";

// Same hidden, cookie-gated pattern as /admin/book-risk and /admin/strategy-ledger.

function stopLossGuidance(s: HighConvictionStrategy): string {
  if (s.exitType !== "time") return "Price-based exit — see the exit rule above; a stop/target is already part of this strategy's own definition.";
  if (s.stopLossVerdict === "stops_hurt") {
    return "Tested against real data: a stop-loss makes this worse, not safer. Size the position assuming the full historical worst case is possible — don't rely on a stop.";
  }
  if (s.stopLossVerdict === "stops_help") {
    return "Tested against real data: a stop-loss at some level meaningfully cuts drawdown while keeping most of the edge — check the Backtest tab's stop-loss overlay for the exact level.";
  }
  if (s.stopLossVerdict === "inconclusive") {
    return "No stop level tested clearly helps or hurts — see the Backtest tab's stop-loss overlay before assuming one either way.";
  }
  return "Stop-loss overlay not yet computed for this engine/signal — treat the largest-loss/max-drawdown figures below as the only real downside data available.";
}

function formatOptionLine(o: NonNullable<HighConvictionStrategy["suggestedOption"]>): string {
  const exp = new Date(`${o.expirationDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${o.underlyingSymbol} $${o.strikePrice} ${o.optionRight === "call" ? "Call" : "Put"}, exp ${exp}`;
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function StrategyCard({ s }: { s: HighConvictionStrategy }) {
  const horizonMatch = s.horizonLabel.match(/(\d+)/);
  const horizonDays = horizonMatch ? Number(horizonMatch[1]) : 20;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-lg font-semibold text-zinc-50">{s.ticker}</div>
          <div className="text-xs text-zinc-400">{s.strategyType} &middot; {s.horizonLabel} &middot; {s.sourceEngine}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-teal-400">{s.winRatePct.toFixed(1)}%</div>
          <div className="text-xs text-zinc-500">win rate, n={s.sampleSize}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs px-2 py-0.5 rounded ${s.passesThreeBars ? "bg-teal-950 text-teal-300 border border-teal-800" : "bg-amber-950 text-amber-300 border border-amber-800"}`}>
          {s.passesThreeBars ? "Passes all 3 statistical bars" : "Win rate high, but did NOT pass the 3-bar significance gate"}
        </span>
        {s.profitFactor !== null && <span className="text-xs text-zinc-400">Profit factor {s.profitFactor.toFixed(2)}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Entry</div>
          <p className="text-zinc-200">{s.entryRule}</p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Exit</div>
          <p className="text-zinc-200">{s.exitRule}</p>
        </div>
      </div>

      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Stop-Loss</div>
        <p className="text-sm text-zinc-200">{stopLossGuidance(s)}</p>
        {(s.largestLossPct !== null || s.maxDrawdownPct !== null) && (
          <p className="text-xs text-red-400 mt-1">
            Worst case in this sample: {s.largestLossPct !== null && <>largest loss {fmtPct(s.largestLossPct)}</>}
            {s.largestLossPct !== null && s.maxDrawdownPct !== null && ", "}
            {s.maxDrawdownPct !== null && <>max drawdown {fmtPct(s.maxDrawdownPct)}</>}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-zinc-800">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Option Structure</div>
        {s.suggestedOption ? (
          <>
            <p className="text-sm text-zinc-200 mb-2">
              <strong>{formatOptionLine(s.suggestedOption)}</strong> — defined risk, expiring past this strategy&apos;s {s.horizonLabel} horizon.
            </p>
            <OptionScenarioPanel
              ticker={s.suggestedOption.underlyingSymbol}
              expirationDate={s.suggestedOption.expirationDate}
              optionRight={s.suggestedOption.optionRight}
              longStrike={s.suggestedOption.strikePrice}
              horizonDays={horizonDays}
            />
          </>
        ) : (
          <p className="text-xs text-zinc-500">{s.optionStructureNote}</p>
        )}
      </div>
    </div>
  );
}

function Dashboard({ strategies, minWinRatePct }: { strategies: HighConvictionStrategy[]; minWinRatePct: number }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <a href="/admin/strategy-ledger" className="text-xs text-teal-400 hover:underline">→ Strategy Ledger</a>
        <h1 className="text-2xl font-bold text-zinc-50 mt-1">High-Conviction Strategy Playbook</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Every real hypothesis-ledger result at or above a {minWinRatePct}% win rate — validated or not (that flag
          is shown per-card, never hidden) — with entry, exit, stop-loss guidance, and a real option structure
          assembled automatically from what this app already computes elsewhere.
        </p>

        {strategies.length === 0 ? (
          <p className="text-sm text-zinc-400 mt-6">No hypothesis-ledger rows at or above {minWinRatePct}% yet.</p>
        ) : (
          <div className="flex flex-col gap-4 mt-6">
            {strategies.map((s) => (
              <StrategyCard key={s.hypothesisId} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdminHighConvictionStrategiesPage({ searchParams }: { searchParams: Promise<{ minWinRate?: string }> }) {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!expected || !session || session !== expected) {
    notFound();
  }
  const { minWinRate } = await searchParams;
  const minWinRatePct = minWinRate ? Number(minWinRate) : 84;
  const strategies = await getHighConvictionStrategies(Number.isFinite(minWinRatePct) ? minWinRatePct : 84);
  return <Dashboard strategies={strategies} minWinRatePct={Number.isFinite(minWinRatePct) ? minWinRatePct : 84} />;
}
