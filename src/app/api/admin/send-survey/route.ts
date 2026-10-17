import { NextResponse } from "next/server";
import { sendSurveyBroadcast } from "@/lib/agents/trading-agent/skills/survey-broadcast";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { clientIp, LockoutLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { timingSafeEqualStr } from "@/lib/access/tokens";

/**
 * Admin-only. Authenticates with EITHER the admin_session cookie (a logged-in admin) OR the secret in an
 * `x-admin-secret` request header, compared in constant time. The secret is no longer accepted in the URL, so it cannot
 * end up in access logs, browser history or shared links:
 *   curl -X POST -H "x-admin-secret: $ADMIN_ANALYTICS_SECRET" "https://<app>/api/admin/send-survey?dryRun=true"
 * dryRun defaults to true - a real send (dryRun=false) is a deliberate, separate step, never triggered by anything
 * automated. This blasts every active alert_subscriptions row once; there's no cadence/schedule here by design.
 * Failed attempts are rate limited per IP (best effort, per instance).
 */
const limiter = new LockoutLimiter(5, 15 * 60_000, 60_000, 60 * 60_000);

export async function POST(request: Request) {
  const ip = clientIp(request);
  const gate = limiter.check(ip);
  if (!gate.allowed) return tooManyRequests(gate);

  const header = request.headers.get("x-admin-secret") ?? "";
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const headerOk = Boolean(expected && header) && (await timingSafeEqualStr(header, expected as string));
  const cookieOk = headerOk ? false : await isAdminSessionValid().catch(() => false);
  if (!headerOk && !cookieOk) {
    limiter.fail(ip);
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  limiter.succeed(ip);

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") !== "false";

  try {
    const outcome = await sendSurveyBroadcast(dryRun);
    const summary = {
      dryRun,
      totalTargeted: outcome.results.length,
      sent: outcome.results.filter((r) => r.status === "sent").length,
      failed: outcome.results.filter((r) => r.status === "failed").length,
      skippedNotConfigured: outcome.results.filter((r) => r.status === "skipped-not-configured").length,
      wouldSend: outcome.results.filter((r) => r.status === "would-send-dry-run").length,
    };
    return NextResponse.json({ summary, results: outcome.results });
  } catch (error) {
    console.error("admin/send-survey failed:", error instanceof Error ? error.message.slice(0, 300) : "unknown error");
    return NextResponse.json({ error: "Survey send failed. See the server log." }, { status: 500 });
  }
}
