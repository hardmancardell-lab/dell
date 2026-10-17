import { NextResponse } from "next/server";
import { submitFeedback, type FeedbackCategory, type FeedbackSource } from "@/lib/analytics/feedback";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";

const VALID_CATEGORIES: FeedbackCategory[] = ["suggestion", "problem", "other"];
const VALID_SOURCES: FeedbackSource[] = ["assistant_chat", "in_app_widget", "survey_broadcast"];

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE = 4000;
const MAX_SHORT = 500;
const MAX_SESSION_ID = 100;

// Best-effort, per-instance: 10 submissions per hour per IP.
const limiter = new SlidingWindowLimiter(10, 60 * 60_000);

/**
 * Public submit endpoint for the FeedbackWidget and the /survey page (the emails promise "no login", so middleware
 * lets it through without a session). Because it is open, it validates every field, caps sizes and rate-limits per IP.
 * The Assistant's chat tool calls submitFeedback directly server-side instead of through this route.
 */
export async function POST(request: Request) {
  const decision = limiter.hit(clientIp(request));
  if (!decision.allowed) return tooManyRequests(decision, "Too many submissions. Please try again later.");

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  if (typeof body.sessionId !== "string" || !body.sessionId.trim() || body.sessionId.length > MAX_SESSION_ID) {
    return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Message is too long (max ${MAX_MESSAGE} characters).` }, { status: 400 });
  }
  const category: FeedbackCategory = VALID_CATEGORIES.includes(body.category as FeedbackCategory) ? (body.category as FeedbackCategory) : "other";
  const source: FeedbackSource = VALID_SOURCES.includes(body.source as FeedbackSource) ? (body.source as FeedbackSource) : "in_app_widget";
  const experienceRating =
    typeof body.experienceRating === "number" && body.experienceRating >= 1 && body.experienceRating <= 5
      ? Math.round(body.experienceRating)
      : null;
  try {
    const result = await submitFeedback({
      sessionId: body.sessionId,
      category,
      message: body.message,
      contextTab: typeof body.contextTab === "string" ? body.contextTab.slice(0, MAX_SHORT) : null,
      experienceRating,
      comparableProducts: typeof body.comparableProducts === "string" ? body.comparableProducts.slice(0, MAX_SHORT) : null,
      source,
    });
    return NextResponse.json(result);
  } catch {
    // Do not echo upstream error text (it can contain database details) to an unauthenticated caller.
    return NextResponse.json({ error: "Could not save feedback. Please try again later." }, { status: 500 });
  }
}
