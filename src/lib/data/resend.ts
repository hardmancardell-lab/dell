// Plain fetch, no SDK — same convention as every other external service in
// this app (Alpaca, Tradier, OANDA, Supabase itself).

const RESEND_API_URL = "https://api.resend.com/emails";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendAlertEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Requires a domain verified in Resend — RESEND_FROM_EMAIL is not a
      // secret, just the sender identity, kept configurable rather than hardcoded.
      from: process.env.RESEND_FROM_EMAIL ?? "Graham Research Agent Alerts <alerts@example.com>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend request failed: ${res.status} ${body}`);
  }
}
