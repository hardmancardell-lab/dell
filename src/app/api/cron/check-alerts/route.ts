import { NextResponse } from "next/server";
import {
  getActiveRulesWithSubscriptions,
  insertAlertLog,
  isAlertsDbConfigured,
  setRuleTriggeredState,
} from "@/lib/data/alerts-db";
import { evaluateAlertRule } from "@/lib/agents/trading-agent/skills/alert-conditions";
import { toEasternParts } from "@/lib/agents/trading-agent/skills/time-windows";
import { isResendConfigured, sendAlertEmail } from "@/lib/data/resend";
import { isTwilioConfigured, sendAlertSms } from "@/lib/data/twilio";
import type { AlertEvaluation, AlertRule } from "@/lib/agents/trading-agent/types";

export const maxDuration = 60;

/**
 * 9:30am-4:00pm ET, Monday-Friday. vercel.json's own cron schedule is a
 * fixed-UTC superset covering both EST and EDT (see ALERTS_INTEGRATION_NOTES.md)
 * — this is the precise trim, same UTC-round-trip weekday derivation
 * calendar-effects.ts's dayOfWeekFromDateKey uses.
 */
function isDuringMarketHours(): boolean {
  const { dateKey, minutesSinceMidnight } = toEasternParts(Date.now());
  const [y, m, d] = dateKey.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  return isWeekday && minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight <= 16 * 60;
}

/** Groups by ticker+condition+params so subscribers watching the same thing share one evaluation — most load-bearing for macro_news_spike, where GDELT rate-limits to ~1 req/5s. */
function cacheKey(rule: AlertRule): string {
  return `${rule.conditionType}:${rule.ticker}:${JSON.stringify(rule.params)}`;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAlertsDbConfigured()) {
    return NextResponse.json({ ok: true, skipped: "Alerts DB not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." });
  }

  if (!isDuringMarketHours()) {
    return NextResponse.json({ ok: true, skipped: "Outside market hours (9:30am-4:00pm ET, weekdays)." });
  }

  const rules = await getActiveRulesWithSubscriptions();
  const evalCache = new Map<string, Promise<AlertEvaluation | { error: string }>>();
  const errors: { ruleId: string; error: string }[] = [];
  let alertsSent = 0;

  for (const rule of rules) {
    try {
      const key = cacheKey(rule);
      if (!evalCache.has(key)) {
        evalCache.set(
          key,
          evaluateAlertRule(rule).catch(
            (err): { error: string } => ({ error: err instanceof Error ? err.message : "unknown error" })
          )
        );
      }
      const result = await evalCache.get(key)!;

      if ("error" in result) {
        errors.push({ ruleId: rule.id, error: result.error });
        continue;
      }

      const wasTriggered = rule.currentlyTriggered;
      const isTriggered = result.triggered;

      // Edge-triggered: send + log only on the false -> true transition.
      // true -> false (and true -> true) just rearm/hold, no resend.
      if (isTriggered && !wasTriggered) {
        const subscription = rule.subscription;
        if (!subscription) {
          errors.push({ ruleId: rule.id, error: "No subscription joined for this rule." });
        } else {
          const channel = subscription.channel;
          let anySent = false;
          let anyAttempted = false;
          let lastError: string | null = null;
          const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/alerts/unsubscribe?token=${subscription.unsubscribeToken}`;

          if ((channel === "email" || channel === "both") && subscription.email) {
            anyAttempted = anyAttempted || isResendConfigured();
            if (isResendConfigured()) {
              try {
                await sendAlertEmail(
                  subscription.email,
                  `Alert: ${rule.ticker} — ${rule.conditionType.replace(/_/g, " ")}`,
                  `<p>${result.message}</p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`
                );
                anySent = true;
              } catch (err) {
                lastError = err instanceof Error ? err.message : "unknown error";
              }
            }
          }
          if ((channel === "sms" || channel === "both") && subscription.phone) {
            anyAttempted = anyAttempted || isTwilioConfigured();
            if (isTwilioConfigured()) {
              try {
                await sendAlertSms(subscription.phone, `${result.message} Reply STOP to unsubscribe.`);
                anySent = true;
              } catch (err) {
                lastError = err instanceof Error ? err.message : "unknown error";
              }
            }
          }

          const deliveryStatus: "sent" | "failed" | "skipped-not-configured" = anySent
            ? "sent"
            : anyAttempted
              ? "failed"
              : "skipped-not-configured";

          await insertAlertLog({
            ruleId: rule.id,
            conditionSnapshot: { message: result.message, proximity: result.proximity },
            channel,
            deliveryStatus,
            error: lastError,
          });
          if (deliveryStatus === "sent") alertsSent++;
        }
      }

      await setRuleTriggeredState(rule.id, isTriggered);
    } catch (err) {
      errors.push({ ruleId: rule.id, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return NextResponse.json({ rulesEvaluated: rules.length, alertsSent, errors });
}
