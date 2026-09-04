import { NextResponse } from "next/server";

/** Temporary — quick check whether Supabase is back after their incident. Remove once done. */
export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  try {
    const res = await fetch(`${url}/rest/v1/advisor_clients?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
