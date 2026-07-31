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
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center">
        <h2 className="text-lg font-semibold mb-1">Thanks!</h2>
        <p className="text-sm text-zinc-500">Your answers are logged. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-5">
      <div>
        <label className="text-sm font-medium block mb-2">How&apos;s your experience been so far?</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`w-11 h-11 rounded-full border text-sm font-medium transition-colors ${
                rating === n
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-zinc-400 mt-1 max-w-[220px]">
          <span>Rough</span>
          <span>Excellent</span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">What do you compare this to? (other apps/tools you use)</label>
        <input
          value={comparableProducts}
          onChange={(e) => setComparableProducts(e.target.value)}
          placeholder="e.g. Seeking Alpha, a spreadsheet, thinkorswim…"
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent"
        />
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">Anything else? (optional)</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Suggestions, bugs, confusing bits — anything."
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting || (rating === null && !comparableProducts.trim() && !message.trim())}
        className="text-sm self-start px-4 py-2 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}
