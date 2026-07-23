import { NextResponse } from "next/server";
import { deactivateSubscriptionsByPhone, isAlertsDbConfigured } from "@/lib/data/alerts-db";

/**
 * Twilio inbound-SMS webhook. Twilio's own account-level STOP handling
 * blocks future sends on Twilio's side but does NOT update this app's
 * database — without this route, alert_subscriptions.active would drift out
 * of sync with what Twilio actually delivers. Always returns 200 with a
 * TwiML response (Twilio's expected reply shape), even on internal error,
 * so the carrier doesn't retry/loop.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const body = String(formData.get("Body") ?? "").trim().toUpperCase();
    const from = String(formData.get("From") ?? "");

    if (body === "STOP" && from && isAlertsDbConfigured()) {
      await deactivateSubscriptionsByPhone(from);
    }
  } catch {
    // Swallow — see doc comment above.
  }

  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
