import { NextResponse } from "next/server";
import { deactivateSubscriptionsByPhone, isAlertsDbConfigured } from "@/lib/data/alerts-db";
import { isValidTwilioSignature, twilioUrlCandidates } from "@/lib/access/twilio-signature";

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Twilio inbound-SMS webhook. Twilio's own account-level STOP handling
 * blocks future sends on Twilio's side but does NOT update this app's
 * database - without this route, alert_subscriptions.active would drift out
 * of sync with what Twilio actually delivers.
 *
 * Public in middleware (Twilio holds no cookies), so it authenticates itself: when TWILIO_AUTH_TOKEN is set the
 * X-Twilio-Signature header (HMAC-SHA1 of URL + sorted form params) must validate, otherwise 403 and nothing is
 * touched. If the token is unset no SMS can be sent either, so the request is accepted as before.
 * A valid request always gets 200 + TwiML, even on internal error, so the carrier doesn't retry/loop.
 * If your public URL differs from what Twilio signs, set TWILIO_WEBHOOK_URL to the exact URL configured in Twilio.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new NextResponse("Payload too large", { status: 413 });

  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const params: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const ok = await isValidTwilioSignature(authToken, request.headers.get("x-twilio-signature"), twilioUrlCandidates(request), params);
    if (!ok) return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const body = String(params.Body ?? "").trim().toUpperCase();
    const from = String(params.From ?? "").slice(0, 32);

    if (body === "STOP" && from && isAlertsDbConfigured()) {
      await deactivateSubscriptionsByPhone(from);
    }
  } catch {
    // Swallow - see doc comment above.
  }

  return new NextResponse(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}
