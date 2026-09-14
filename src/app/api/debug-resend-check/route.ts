import { NextResponse } from "next/server";

// TEMP diagnostic route — pings Resend's own /domains endpoint (a real,
// harmless, no-side-effect call: it validates the API key without sending
// any mail) so we can see whether RESEND_API_KEY actually authenticates on
// production, without ever exposing the key's value. Delete after use.
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false });
  }
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.text().catch(() => "");
  return NextResponse.json({
    configured: true,
    keyLength: apiKey.length,
    keyPrefix: apiKey.slice(0, 3),
    status: res.status,
    ok: res.ok,
    body: body.slice(0, 500),
  });
}
