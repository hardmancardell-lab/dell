import { NextResponse } from "next/server";
import { createRules, createSubscription, isAlertsDbConfigured } from "@/lib/data/alerts-db";
import type { AlertSubscribeRequest } from "@/lib/agents/trading-agent/types";

export async function POST(request: Request) {
  if (!isAlertsDbConfigured()) {
    return NextResponse.json(
      { error: "Alerts are not configured on this deployment — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset." },
      { status: 503 }
    );
  }

  let body: AlertSubscribeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Re-validated server-side — never trust the client's own checkbox state alone.
  if (body.consent !== true) {
    return NextResponse.json({ error: "Consent is required to subscribe to alerts." }, { status: 400 });
  }
  if (!body.email && !body.phone) {
    return NextResponse.json({ error: "At least one of email or phone is required." }, { status: 400 });
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return NextResponse.json({ error: "At least one alert rule is required." }, { status: 400 });
  }

  try {
    const subscription = await createSubscription({ email: body.email, phone: body.phone, channel: body.channel });
    const rules = await createRules(subscription.id, body.rules);
    return NextResponse.json({ subscription, rules });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
