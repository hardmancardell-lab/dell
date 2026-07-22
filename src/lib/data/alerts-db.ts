import type { AlertChannel, AlertConditionType, AlertRule, AlertRuleInput, AlertSubscription, AssetClass } from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for alert_subscriptions/alert_rules/alert_log
 * — same header/Prefer pattern as src/lib/analytics/supabase.ts, kept in its
 * own file since this is real per-user data (contact info + consent), not
 * anonymous analytics, even though it lives in the same Supabase project.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isAlertsDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
}

async function supabaseRequest<T>(
  path: string,
  init: { method: string; body?: unknown; prefer?: string }
): Promise<T> {
  const { url, key } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: init.prefer ?? "return=minimal",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text}`);
  }
  if (init.prefer === "return=representation") {
    return (await res.json()) as T;
  }
  return undefined as T;
}

// --- row <-> TS type mappers (Supabase REST returns snake_case columns) ---

interface SubscriptionRow {
  id: string;
  email: string | null;
  phone: string | null;
  channel: AlertChannel;
  consent_at: string;
  unsubscribe_token: string;
  active: boolean;
  created_at: string;
}

function toSubscription(row: SubscriptionRow): AlertSubscription {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    channel: row.channel,
    consentAt: row.consent_at,
    unsubscribeToken: row.unsubscribe_token,
    active: row.active,
    createdAt: row.created_at,
  };
}

interface RuleRow {
  id: string;
  subscription_id: string;
  ticker: string;
  asset_class: AssetClass;
  condition_type: AlertConditionType;
  params: Record<string, unknown>;
  currently_triggered: boolean;
  last_evaluated_at: string | null;
  active: boolean;
  created_at: string;
  subscription?: SubscriptionRow;
}

function toRule(row: RuleRow): AlertRule {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    ticker: row.ticker,
    assetClass: row.asset_class,
    conditionType: row.condition_type,
    params: row.params,
    currentlyTriggered: row.currently_triggered,
    lastEvaluatedAt: row.last_evaluated_at,
    active: row.active,
    createdAt: row.created_at,
    subscription: row.subscription ? toSubscription(row.subscription) : undefined,
  };
}

export async function createSubscription(input: {
  email: string | null;
  phone: string | null;
  channel: AlertChannel;
}): Promise<AlertSubscription> {
  const unsubscribeToken = crypto.randomUUID();
  const rows = await supabaseRequest<SubscriptionRow[]>("alert_subscriptions", {
    method: "POST",
    prefer: "return=representation",
    body: { email: input.email, phone: input.phone, channel: input.channel, unsubscribe_token: unsubscribeToken },
  });
  return toSubscription(rows[0]);
}

export async function createRules(subscriptionId: string, rules: AlertRuleInput[]): Promise<AlertRule[]> {
  const rows = await supabaseRequest<RuleRow[]>("alert_rules", {
    method: "POST",
    prefer: "return=representation",
    body: rules.map((r) => ({
      subscription_id: subscriptionId,
      ticker: r.ticker,
      asset_class: r.assetClass,
      condition_type: r.conditionType,
      params: r.params,
    })),
  });
  return rows.map(toRule);
}

/** Active rules joined with their (also active) subscription — the cron route's main read. */
export async function getActiveRulesWithSubscriptions(): Promise<AlertRule[]> {
  const rows = await supabaseRequest<RuleRow[]>(
    "alert_rules?select=*,subscription:alert_subscriptions!inner(*)&active=eq.true&subscription.active=eq.true",
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toRule);
}

export async function setRuleTriggeredState(ruleId: string, currentlyTriggered: boolean): Promise<void> {
  await supabaseRequest(`alert_rules?id=eq.${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    body: { currently_triggered: currentlyTriggered, last_evaluated_at: new Date().toISOString() },
  });
}

export async function insertAlertLog(entry: {
  ruleId: string;
  conditionSnapshot: Record<string, unknown> | null;
  channel: AlertChannel;
  deliveryStatus: "sent" | "failed" | "skipped-not-configured";
  error: string | null;
}): Promise<void> {
  await supabaseRequest("alert_log", {
    method: "POST",
    body: {
      rule_id: entry.ruleId,
      condition_snapshot: entry.conditionSnapshot,
      channel: entry.channel,
      delivery_status: entry.deliveryStatus,
      error: entry.error,
    },
  });
}

/** Returns true if a matching active subscription was found and deactivated. */
export async function deactivateSubscriptionByToken(token: string): Promise<boolean> {
  const rows = await supabaseRequest<SubscriptionRow[]>(`alert_subscriptions?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { active: false },
  });
  return rows.length > 0;
}

/** Twilio's own STOP handling blocks future sends on their side but doesn't touch our database — the SMS webhook calls this to keep alert_subscriptions.active in sync. */
export async function deactivateSubscriptionsByPhone(phone: string): Promise<number> {
  const rows = await supabaseRequest<SubscriptionRow[]>(`alert_subscriptions?phone=eq.${encodeURIComponent(phone)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { active: false },
  });
  return rows.length;
}
