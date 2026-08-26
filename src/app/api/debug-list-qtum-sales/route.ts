import { NextResponse } from "next/server";

/** Temporary — checks for accidental duplicate QTUM realized_pnl rows from a flawed check script. Remove once done. */
export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(
    `${url}/rest/v1/advisor_client_realized_pnl?client_id=eq.0e527bda-1c72-481b-8a8b-f8ca05820d7d&symbol=eq.QTUM&select=*`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const json = await res.json();
  return NextResponse.json({ status: res.status, rows: json });
}

/** Deletes one specific duplicate row by id, passed as ?id=. */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/rest/v1/advisor_client_realized_pnl?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return NextResponse.json({ status: res.status, ok: res.ok });
}
