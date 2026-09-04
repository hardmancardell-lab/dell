import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getBookRiskSummary } from "@/lib/agents/trading-agent/skills/book-risk";
import type { BookRiskSummary } from "@/lib/agents/trading-agent/skills/book-risk";

// Same hidden, cookie-gated pattern as /admin/analytics and /admin/clients —
// sign in once at /admin/login, plain 404 on any missing/invalid session.

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function Dashboard({ data }: { data: BookRiskSummary }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <a href="/admin/clients" className="text-xs text-teal-400 hover:underline">→ Client Dashboards</a>
        <h1 className="text-2xl font-bold text-zinc-50 mt-1">Book Risk</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Every real client holding, cross-referenced against today&apos;s live+validated Guided Trade Signals —
          generated {fmtDate(data.generatedAt)}.
        </p>

        <div className="grid grid-cols-3 gap-4 my-6">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">Clients Scanned</div>
            <div className="text-2xl font-semibold tabular-nums text-zinc-50">{data.clientsScanned}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">Distinct Symbols Held</div>
            <div className="text-2xl font-semibold tabular-nums text-zinc-50">{data.symbolsHeld}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">Symbols With a Live Signal</div>
            <div className="text-2xl font-semibold tabular-nums text-teal-400">{data.symbolsWithLiveSignal}</div>
          </div>
        </div>

        {data.bySymbol.length === 0 ? (
          <p className="text-sm text-zinc-400">No client holdings yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.bySymbol.map((row) => (
              <div
                key={row.symbol}
                className={row.liveSignal ? "rounded-lg border p-4" : "rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"}
                style={row.liveSignal ? { borderColor: "rgb(45 212 191 / 0.4)", background: "rgb(45 212 191 / 0.06)" } : undefined}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-base font-semibold text-zinc-50">{row.symbol}</div>
                  <div className="text-xs text-zinc-400">
                    {row.totalShares} total shares &middot; {row.clientCount} client{row.clientCount === 1 ? "" : "s"}
                  </div>
                </div>
                {row.liveSignal && (
                  <div className="text-sm text-teal-300 mb-2">
                    Live signal: <strong>{row.liveSignal.headline}</strong> — {row.liveSignal.historicalWinRatePct.toFixed(0)}% historical
                    win rate (n={row.liveSignal.sampleSize})
                  </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  {row.clients.map((c) => (
                    <span key={c.clientSlug}>
                      {c.clientName}: {c.shares} sh
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdminBookRiskPage() {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!expected || !session || session !== expected) {
    notFound();
  }
  const data = await getBookRiskSummary();
  return <Dashboard data={data} />;
}
