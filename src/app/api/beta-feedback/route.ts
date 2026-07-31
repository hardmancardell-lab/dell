import { NextResponse } from "next/server";
import { submitFeedback, type FeedbackCategory, type FeedbackSource } from "@/lib/analytics/feedback";

const VALID_CATEGORIES: FeedbackCategory[] = ["suggestion", "problem", "other"];
const VALID_SOURCES: FeedbackSource[] = ["assistant_chat", "in_app_widget", "survey_broadcast"];

/**
 * Public submit endpoint for the FeedbackWidget and the /survey page — both
 * structured (rating + comparable products) unlike the Assistant's chat tool,
 * which calls submitFeedback directly server-side instead of through this route.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.sessionId || typeof body.sessionId !== "string") {
    return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
  }
  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }
  const category: FeedbackCategory = VALID_CATEGORIES.includes(body.category) ? body.category : "other";
  const source: FeedbackSource = VALID_SOURCES.includes(body.source) ? body.source : "in_app_widget";
  const experienceRating =
    typeof body.experienceRating === "number" && body.experienceRating >= 1 && body.experienceRating <= 5
      ? Math.round(body.experienceRating)
      : null;
  try {
    const result = await submitFeedback({
      sessionId: body.sessionId,
      category,
      message: body.message,
      contextTab: typeof body.contextTab === "string" ? body.contextTab : null,
      experienceRating,
      comparableProducts: typeof body.comparableProducts === "string" ? body.comparableProducts : null,
      source,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
