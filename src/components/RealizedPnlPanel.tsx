import type { RealizedSale } from "@/lib/agents/trading-agent/types";
import type { WashSaleFlag } from "@/lib/agents/trading-agent/skills/wash-sale-check";

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Read-only realized-P&L + wash-sale display, shared across every surface
 * that can now see it: the self-service Portfolio Tracker (linked and local
 * modes) and the passcode-based client dashboard. Deliberately read-only —
 * recording a sale against an advisor-managed holding stays admin-initiated
 * (see AdvisorClientsManager's own inline sell UI, a separate Tailwind-styled
 * component not touched here); the local/self-directed tracker gets its own
 * sell form wired directly into its holdings table, not through this panel.
 */
export function RealizedPnlPanel({
  sales,
  totalRealizedPnl,
  washSaleFlags,
}: {
  sales: RealizedSale[];
  totalRealizedPnl: number;
  washSaleFlags: WashSaleFlag[];
}) {
  return (
    <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="jv-strip-title" style={{ marginBottom: 0 }}>Realized P&amp;L</h3>
        <div className="text-sm font-medium tabular-nums" style={{ color: totalRealizedPnl >= 0 ? "var(--signal)" : "var(--danger)" }}>
          Total: {fmtUsd(totalRealizedPnl)}
        </div>
      </div>

      {washSaleFlags.length > 0 && (
        <div className="jv-card mb-3 text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          <strong>{washSaleFlags.length} potential wash-sale{washSaleFlags.length === 1 ? "" : "s"}</strong> — a loss was
          realized within 30 days of acquiring a matching lot of the same symbol. Directional flag only, not tax advice:
          checks exact-ticker proximity, not the full &quot;substantially identical security&quot; rule.
        </div>
      )}

      {sales.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>No sales recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="jv-table">
            <thead>
              <tr>
                <th className="text-left">Symbol</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Sale Price</th>
                <th className="text-right">Cost Basis</th>
                <th className="text-right">Fee</th>
                <th className="text-right">Realized P&amp;L</th>
                <th className="text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const flag = washSaleFlags.find((f) => f.saleId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="font-medium">
                      {s.symbol}
                      {flag && (
                        <span
                          className="ml-1.5"
                          style={{ color: "var(--verdict)" }}
                          title={`Lot re-acquired ${Math.abs(flag.daysBetween)} day(s) ${flag.daysBetween >= 0 ? "after" : "before"} this sale`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="jv-num">{s.sharesSold}</td>
                    <td className="jv-num">{fmtUsd(s.salePricePerShare)}</td>
                    <td className="jv-num">{fmtUsd(s.costBasisPerShare)}</td>
                    <td className="jv-num">{fmtUsd(s.fee)}</td>
                    <td className="jv-num font-medium" style={{ color: s.realizedPnl >= 0 ? "var(--signal)" : "var(--danger)" }}>
                      {fmtUsd(s.realizedPnl)}
                    </td>
                    <td style={{ color: "var(--text-2)" }}>{s.saleDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
