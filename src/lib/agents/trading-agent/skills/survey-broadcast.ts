import { getActiveSubscriptions } from "@/lib/data/alerts-db";
import { isResendConfigured, sendAlertEmail } from "@/lib/data/resend";
import { isTwilioConfigured, sendAlertSms } from "@/lib/data/twilio";

/**
 * A one-time survey blast reusing the alert-delivery infrastructure (Resend/
 * Twilio) against the existing alert_subscriptions list — the only pool of
 * people who've given contact info + consent. This is NOT a condition-
 * triggered alert (no cron, no alert_rules involvement) and is never fired
 * automatically; the admin route that calls this always defaults to a dry
 * run. A survey is a different message category than "the price alert you
 * signed up for", so the message body says plainly it's a short survey, not
 * a triggered condition, and still honors the same unsubscribe mechanism.
 */

export interface SurveySendResult {
  subscriptionId: string;
  channel: string;
  status: "sent" | "failed" | "skipped-not-configured" | "would-send-dry-run";
  error?: string;
}

function surveyUrl(subscriptionId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/survey?ref=${subscriptionId}`;
}

function emailHtml(subscriptionId: string, unsubscribeToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `<p>Quick 2-question survey — takes under a minute, no login: <a href="${surveyUrl(subscriptionId)}">${surveyUrl(subscriptionId)}</a></p><p>This is a one-time beta feedback request, not a price alert.</p><p><a href="${base}/api/alerts/unsubscribe?token=${unsubscribeToken}">Unsubscribe from alerts</a></p>`;
}

function smsBody(subscriptionId: string): string {
  return `Quick beta survey (1 min, no login): ${surveyUrl(subscriptionId)} Reply STOP to unsubscribe.`;
}

/**
 * dryRun (the default the API route uses) evaluates the real subscriber list
 * and returns exactly what WOULD be sent to whom, without calling
 * Resend/Twilio at all — the only way to preview a real send count before
 * committing to it.
 */
export async function sendSurveyBroadcast(dryRun: boolean): Promise<{ results: SurveySendResult[]; dryRun: boolean }> {
  const subscriptions = await getActiveSubscriptions();
  const results: SurveySendResult[] = [];

  for (const sub of subscriptions) {
    const wantsEmail = (sub.channel === "email" || sub.channel === "both") && sub.email;
    const wantsSms = (sub.channel === "sms" || sub.channel === "both") && sub.phone;

    if (wantsEmail) {
      if (dryRun) {
        results.push({ subscriptionId: sub.id, channel: "email", status: "would-send-dry-run" });
      } else if (!isResendConfigured()) {
        results.push({ subscriptionId: sub.id, channel: "email", status: "skipped-not-configured" });
      } else {
        try {
          await sendAlertEmail(sub.email as string, "Quick beta feedback survey", emailHtml(sub.id, sub.unsubscribeToken));
          results.push({ subscriptionId: sub.id, channel: "email", status: "sent" });
        } catch (err) {
          results.push({ subscriptionId: sub.id, channel: "email", status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    }

    if (wantsSms) {
      if (dryRun) {
        results.push({ subscriptionId: sub.id, channel: "sms", status: "would-send-dry-run" });
      } else if (!isTwilioConfigured()) {
        results.push({ subscriptionId: sub.id, channel: "sms", status: "skipped-not-configured" });
      } else {
        try {
          await sendAlertSms(sub.phone as string, smsBody(sub.id));
          results.push({ subscriptionId: sub.id, channel: "sms", status: "sent" });
        } catch (err) {
          results.push({ subscriptionId: sub.id, channel: "sms", status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    }
  }

  return { results, dryRun };
}
