import { NextResponse } from "next/server";
import { createRules, createSubscription, isAlertsDbConfigured } from "@/lib/data/alerts-db";
import type { AlertChannel, AlertConditionType, AlertRuleInput, AssetClass } from "@/lib/agents/trading-agent/types";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { isValidSessionId } from "@/lib/data/postgrest-safe";

const CHANNELS: AlertChannel[] = ["email", "sms", "both"];
const CONDITIONS: AlertConditionType[] = ["price_threshold", "volume_displacement", "momentum", "mean_reversion", "orb_breakout", "unusual_options", "macro_news_spike"];
const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity", "crypto"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const TICKER = /^[A-Za-z0-9][A-Za-z0-9.\-=/^]{0,14}$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RULES = 10;
const MAX_PARAMS_JSON = 1024;

// Best-effort, per-instance abuse limits (see src/lib/access/rate-limit.ts). Subscribing sends a message to an address
// or number the caller typed, so it can be used to annoy a third party or to run up SMS cost:
//   - 5 subscriptions per hour and 15 per day per IP
//   - 3 per day per target email/phone (stops one victim being flooded from many IPs, within one instance)
// The durable fix is double opt-in, designed in ALERTS_DOUBLE_OPT_IN_NOTES.md.
const perIpHour = new SlidingWindowLimiter(5, 60 * 60_000);
const perIpDay = new SlidingWindowLimiter(15, 24 * 60 * 60_000);
const perTargetDay = new SlidingWindowLimiter(3, 24 * 60 * 60_000);

function clean(body: unknown):
  | { ok: true; email: string | null; phone: string | null; channel: AlertChannel; rules: AlertRuleInput[]; sessionId: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON body." };
  const b = body as Record<string, unknown>;
  // Re-validated server-side - never trust the client's own checkbox state alone.
  if (b.consent !== true) return { ok: false, error: "Consent is required to subscribe to alerts." };

  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().toLowerCase() : null;
  const phone = typeof b.phone === "string" && b.phone.trim() ? b.phone.trim().replace(/[\s().-]/g, "") : null;
  if (!email && !phone) return { ok: false, error: "At least one of email or phone is required." };
  if (email && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "That email address does not look valid." };
  if (phone && !E164.test(phone)) return { ok: false, error: "Phone must be in international format, for example +15555550100." };

  const channel = b.channel as AlertChannel;
  if (!CHANNELS.includes(channel)) return { ok: false, error: "channel must be email, sms or both." };
  if ((channel === "email" || channel === "both") && !email) return { ok: false, error: "An email address is required for that channel." };
  if ((channel === "sms" || channel === "both") && !phone) return { ok: false, error: "A phone number is required for that channel." };

  if (!Array.isArray(b.rules) || b.rules.length === 0) return { ok: false, error: "At least one alert rule is required." };
  if (b.rules.length > MAX_RULES) return { ok: false, error: `At most ${MAX_RULES} alert rules per subscription.` };
  const rules: AlertRuleInput[] = [];
  for (const r of b.rules as unknown[]) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, error: "Invalid alert rule." };
    const x = r as Record<string, unknown>;
    if (typeof x.ticker !== "string" || !TICKER.test(x.ticker.trim())) return { ok: false, error: "Invalid ticker in an alert rule." };
    if (!ASSET_CLASSES.includes(x.assetClass as AssetClass)) return { ok: false, error: "Invalid asset class in an alert rule." };
    if (!CONDITIONS.includes(x.conditionType as AlertConditionType)) return { ok: false, error: "Invalid condition in an alert rule." };
    const params = x.params === undefined || x.params === null ? {} : x.params;
    if (typeof params !== "object" || Array.isArray(params) || JSON.stringify(params).length > MAX_PARAMS_JSON) return { ok: false, error: "Invalid alert rule parameters." };
    rules.push({ ticker: x.ticker.trim().toUpperCase(), assetClass: x.assetClass as AssetClass, conditionType: x.conditionType as AlertConditionType, params: params as Record<string, unknown> });
  }
  return { ok: true, email, phone, channel, rules, sessionId: isValidSessionId(b.sessionId) ? b.sessionId : null };
}

export async function POST(request: Request) {
  if (!isAlertsDbConfigured()) {
    return NextResponse.json(
      { error: "Alerts are not configured on this deployment - SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset." },
      { status: 503 }
    );
  }

  const ip = clientIp(request);
  const hourly = perIpHour.hit(ip);
  if (!hourly.allowed) return tooManyRequests(hourly, "Too many alert signups from this network. Please try again later.");
  const daily = perIpDay.hit(ip);
  if (!daily.allowed) return tooManyRequests(daily, "Too many alert signups from this network today.");

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const checked = clean(parsed);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  for (const target of [checked.email, checked.phone]) {
    if (!target) continue;
    const d = perTargetDay.hit(target);
    if (!d.allowed) return tooManyRequests(d, "That address or number has received too many signups today.");
  }

  try {
    const subscription = await createSubscription({ email: checked.email, phone: checked.phone, channel: checked.channel, sessionId: checked.sessionId });
    const rules = await createRules(subscription.id, checked.rules);
    return NextResponse.json({ subscription, rules });
  } catch (error) {
    console.error("alerts/subscribe failed:", error instanceof Error ? error.message.slice(0, 300) : "unknown error");
    return NextResponse.json({ error: "Could not save your alert signup. Please try again later." }, { status: 500 });
  }
}
