import { NextResponse } from "next/server";
import { sendSurveyBroadcast } from "@/lib/agents/trading-agent/skills/survey-broadcast";

/**
 * Secret-gated, same convention as /admin/analytics (?secret=ADMIN_ANALYTICS_SECRET).
 * dryRun defaults to true — a real send (dryRun=false) is a deliberate, separate
 * step, never triggered by anything automated. This blasts every active
 * alert_subscriptions row once; there's no cadence/schedule here by design.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
