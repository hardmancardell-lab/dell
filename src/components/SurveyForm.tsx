"use client";

import { useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";

/** Same 3-question shape as FeedbackWidget, tagged source="survey_broadcast" so admin can tell outbound-survey responses apart from passive in-app feedback. */
export function SurveyForm({ referral }: { referral: string | null }) {
  const [rating, setRating] = useState<number | null>(null);
  const [comparableProducts, setComparableProducts] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/beta-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getOrCreateSessionId(),
          category: "other",
          message: message.trim() || "(no additional comments)",
          contextTab: referral ? `survey-ref:${referral}` : "survey",
          experienceRating: rating,
          comparableProducts: comparableProducts.trim() || null,
          source: "survey_broadcast",
        }),
      });
      const json = await res.json();
      if (!res.ok || json.stored === false) {
        setError(json.stored === false ? "Feedback capture isn't set up yet." : json.error ?? "Something went wrong.");
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="jarvis">
        <div className="jv-card text-center">
          <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>Thanks!</h2>
          <p className="text-sm" style={{ color: "var(--text-1)" }}>Your answers are logged. You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="jarvis">
      <div className="jv-card flex flex-col gap-5">
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: "var(--text-0)" }}>How&apos;s your experience been so far?</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className="w-11 h-11 rounded-full border text-sm font-medium transition-colors"
                style={
                  rating === n
                    ? { background: "var(--signal)", color: "var(--ink-950)", borderColor: "var(--signal)" }
                    : { borderColor: "var(--line-bright)", color: "var(--text-1)" }
                }
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs mt-1 max-w-[220px]" style={{ color: "var(--text-2)" }}>
            <span>Rough</span>
            <span>Excellent</span>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: "var(--text-0)" }}>What do you compare this to? (other apps/tools you use)</label>
          <input
            value={comparableProducts}
            onChange={(e) => setComparableProducts(e.target.value)}
            placeholder="e.g. Seeking Alpha, a spreadsheet, thinkorswim…"
            className="jv-input w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: "var(--text-0)" }}>Anything else? (optional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Suggestions, bugs, confusing bits — anything."
            className="jv-input w-full resize-none"
          />
        </div>

        {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

        <button
          onClick={submit}
          disabled={submitting || (rating === null && !comparableProducts.trim() && !message.trim())}
          className="jv-btn self-start"
        >
          {submitting ? "Sending…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
