import { hmacSha1Base64, timingSafeEqualStr } from "./tokens";

/**
 * Twilio request validation: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted(key+value) of the POST params)).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export async function expectedTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return hmacSha1Base64(authToken, data);
}

export async function isValidTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  urlCandidates: string[],
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  for (const url of urlCandidates) {
    if (await timingSafeEqualStr(await expectedTwilioSignature(authToken, url, params), signature)) return true;
  }
  return false;
}

/**
 * Candidate public URLs for the request. Behind Vercel's proxy request.url can differ from what Twilio signed, so we try
 * TWILIO_WEBHOOK_URL (explicit, preferred), the request URL, and the x-forwarded-proto/host rebuild.
 */
export function twilioUrlCandidates(request: Request): string[] {
  const out: string[] = [];
  if (process.env.TWILIO_WEBHOOK_URL) out.push(process.env.TWILIO_WEBHOOK_URL);
  out.push(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) {
    const u = new URL(request.url);
    out.push(`${proto}://${host}${u.pathname}${u.search}`);
  }
  return [...new Set(out)];
}
