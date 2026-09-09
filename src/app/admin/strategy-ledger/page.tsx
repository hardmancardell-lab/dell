import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { listAllSuggestions } from "@/lib/data/strategy-suggestion-db";
import type { OptionStrategyVariant, StrategySuggestion } from "@/lib/agents/trading-agent/types";

// Same hidden, cookie-gated pattern as /admin/book-risk and /admin/clients —
// sign in once at /admin/login, plain 404 on any missing/invalid session.

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function variantLabel(v: OptionStrategyVariant): string {
  return v === "long_option" ? "Long Option" : "Debit Spread";
}

interface VariantStats {
  variant: OptionStrategyVariant;
  open: number;
  closed: number;
  totalRealizedPnl: number;
  winCount: number;
  avgRealizedPnl: number | null;
}

function computeStats(rows: StrategySuggestion[]): VariantStats[] {
  return (["long_option", "debit_spread"] as OptionStrategyVariant[]).map((variant) => {
    const forVariant = rows.filter((r) => r.variant === variant);
    const closed = forVariant.filter((r) => r.status === "closed" && r.realizedPnlPerContract !== null);
    const totalRealizedPnl = closed.reduce((sum, r) => sum + (r.realizedPnlPerContract ?? 0), 0);
    const winCount = closed.filter((r) => (r.realizedPnlPerContract ?? 0) > 0).length;
    return {
      variant,
      open: forVariant.filter((r) => r.status === "open").length,
      closed: closed.length,
      totalRealizedPnl,
      winCount,
      avgRealizedPnl: closed.length > 0 ? totalRealizedPnl / closed.length : null,
    };
  });
}

function Dashboard({ rows }: { rows: StrategySuggestion[] }) {
  const stats = computeStats(rows);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <a href="/admin/book-risk" className="text-xs text-teal-400 hover:underline">→ Book Risk</a>
        <h1 className="text-2xl font-bold text-zinc-50 mt-1">Strategy Suggestion Ledger</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Every real Guided Trade Signal occurrence, recorded automatically under both option-strategy variants —
          independent of whether any client placed the client-facing suggestion. Real forward (not backtested)
          performance, one contract per suggestion, closed against the live options chain once each signal&apos;s own
          horizon actually elapses (measured in real trading days).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
          {stats.map((s) => (
            <div key={s.variant} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="text-sm font-semibold text-zinc-50 mb-2">{variantLabel(s.variant)}</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Open</div>
                  <div className="tabular-nums text-zinc-100">{s.open}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Closed</div>
                  <div className="tabular-nums text-zinc-100">{s.closed}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Win Rate</div>
                  <div className="tabular-nums text-zinc-100">{s.closed > 0 ? `${((s.winCount / s.closed) * 100).toFixed(0)}%` : "N/A"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Avg P&amp;L / Contract</div>
                  <div className={`tabular-nums font-medium ${s.avgRealizedPnl !== null && s.avgRealizedPnl >= 0 ? "text-teal-400" : "text-red-400"}`}>
                    {s.avgRealizedPnl !== null ? fmtUsd(s.avgRealizedPnl) : "N/A"}
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-400">
                Total realized: <span className={s.totalRealizedPnl >= 0 ? "text-teal-400" : "text-red-400"}>{fmtUsd(s.totalRealizedPnl)}</span>
              </div>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-400">No suggestions recorded yet — these get logged the next time a Guided Trade Signal actually triggers.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-4 font-normal">Ticker</th>
                  <th className="py-2 pr-4 font-normal">Strategy</th>
                  <th className="py-2 pr-4 font-normal">Variant</th>
                  <th className="py-2 pr-4 font-normal">Contract</th>
                  <th className="py-2 pr-4 font-normal">Entry</th>
                  <th className="py-2 pr-4 font-normal text-right">Entry Debit</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                  <th className="py-2 pr-4 font-normal text-right">Exit Debit</th>
                  <th className="py-2 pr-4 font-normal text-right">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/60">
                    <td className="py-1.5 pr-4 font-medium text-zinc-100">{r.ticker}</td>
                    <td className="py-1.5 pr-4 text-zinc-300">{r.strategyType}</td>
                    <td className="py-1.5 pr-4 text-zinc-300">{variantLabel(r.variant)}</td>
                    <td className="py-1.5 pr-4 text-zinc-400">
                      {r.optionRight === "call" ? "C" : "P"} ${r.longStrike}
                      {r.shortStrike !== null ? ` / $${r.shortStrike}` : ""} exp {r.expirationDate}
                    </td>
                    <td className="py-1.5 pr-4 text-zinc-400">{r.entryDate}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-300">{fmtUsd(r.entryDebit)}</td>
                    <td className="py-1.5 pr-4">
                      <span className={r.status === "open" ? "text-amber-400" : "text-zinc-400"}>{r.status}</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-300">{r.exitDebit !== null ? fmtUsd(r.exitDebit) : "—"}</td>
                    <td className={`py-1.5 pr-4 text-right tabular-nums font-medium ${r.realizedPnlPerContract === null ? "text-zinc-500" : r.realizedPnlPerContract >= 0 ? "text-teal-400" : "text-red-400"}`}>
                      {r.realizedPnlPerContract !== null ? fmtUsd(r.realizedPnlPerContract) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdminStrategyLedgerPage() {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!expected || !session || session !== expected) {
    notFound();
  }
  const rows = await listAllSuggestions();
  return <Dashboard rows={rows} />;
}
