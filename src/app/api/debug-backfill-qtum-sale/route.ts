import { NextResponse } from "next/server";

/** Temporary, one-off — backfills Christopher's real QTUM sale (2 @ $148.82, $2 fee) into the new realized_pnl table, since it was applied before that table existed. Remove once done. */
export async function POST() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/rest/v1/advisor_client_realized_pnl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      client_id: "0e527bda-1c72-481b-8a8b-f8ca05820d7d",
      symbol: "QTUM",
      shares_sold: 2,
      sale_price_per_share: 148.82,
      fee: 2,
      cost_basis_per_share: 154.65,
      realized_pnl: (148.82 - 154.65) * 2 - 2,
      sale_date: "2026-08-26",
    }),
  });
  const json = await res.json();
  return NextResponse.json({ status: res.status, result: json });
}
