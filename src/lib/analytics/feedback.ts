const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export type FeedbackCategory = "suggestion" | "problem" | "other";

/** Where a feedback row originated — lets the admin dashboard and any query separate
 * chat-captured asides from the dedicated widget and from an outbound survey blast. */
export type FeedbackSource = "assistant_chat" | "in_app_widget" | "survey_broadcast";

export interface FeedbackSubmission {
  sessionId: string;
  category: FeedbackCategory;
  message: string;
  contextTab?: string | null;
  /** 1-5, "how's your experience been" — optional since the Assistant's chat capture never asks this. */
  experienceRating?: number | null;
  /** Free text: what they compare this app to (other apps/tools). */
  comparableProducts?: string | null;
  source?: FeedbackSource;
}

/**
 * Feedback capture, shared by three entry points: the Assistant's chat-driven
 * submit_feedback tool (tools.ts, unstructured aside), the always-visible
 * FeedbackWidget (structured: rating + comparability + message), and a
 * one-time survey broadcast reusing the same 3 questions. Same plain-fetch
 * Supabase REST pattern as analytics/supabase.ts, kept in a separate
 * file/table since this is user-authored free text, not anonymous usage
 * events. Returns {stored: false} rather than throwing when Supabase isn't
 * configured, so callers can tell the user honestly instead of erroring.
 */
export async function submitFeedback(entry: FeedbackSubmission): Promise<{ stored: boolean }> {
  if (!isSupabaseConfigured()) return { stored: false };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      session_id: entry.sessionId,
      category: entry.category,
      message: entry.message,
      context_tab: entry.contextTab ?? null,
      experience_rating: entry.experienceRating ?? null,
      comparable_products: entry.comparableProducts ?? null,
      source: entry.source ?? "assistant_chat",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase feedback insert failed (${res.status}): ${text}`);
  }
  return { stored: true };
}
