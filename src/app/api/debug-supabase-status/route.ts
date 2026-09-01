import { NextResponse } from "next/server";

/** Temporary — real Supabase REST hit to confirm the project is responsive (not paused) and to reset its inactivity clock. Remove once done. */
export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const started = Date.now();
  const res = await fetch(`${url}/rest/v1/advisor_clients?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const elapsedMs = Date.now() - started;
  const body = await res.text();

  return NextResponse.json({
    supabaseUrl: url,
    httpStatus: res.status,
    ok: res.ok,
    elapsedMs,
    bodyPreview: body.slice(0, 200),
    checkedAt: new Date().toISOString(),
  });
}
