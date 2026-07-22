const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export type FeedbackCategory = "suggestion" | "problem" | "other";

export interface FeedbackSubmission {
  sessionId: string;
  category: FeedbackCategory;
  message: string;
  contextTab?: string | null;
}

/**
 * Feedback the Assistant captures from the chat itself (see submit_feedback
 * in tools.ts) — same plain-fetch Supabase REST pattern as
 * analytics/supabase.ts, kept in a separate file/table since this is
 * user-authored free text, not structured anonymous usage events. Returns
 * {stored: false} rather than throwing when Supabase isn't configured, so
 * the assistant can tell the user honestly instead of erroring the turn.
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
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase feedback insert failed (${res.status}): ${text}`);
  }
  return { stored: true };
}
