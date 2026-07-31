"use client";

import { useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";

/**
 * Always-visible feedback entry point — a floating button, not buried inside
 * the Assistant chat tab. Same 3-question shape as the /survey page (rating +
 * comparability + open message) so both feed the same `feedback` table with
 * a distinguishing `source`. Beta-testing process: this is the passive/
 * anytime path; /survey is the active outbound path via an alert-style email/SMS.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
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
          contextTab: typeof window !== "undefined" ? window.location.pathname : null,
          experienceRating: rating,
          comparableProducts: comparableProducts.trim() || null,
          source: "in_app_widget",
        }),
      });
      const json = await res.json();
      if (!res.ok || json.stored === false) {
        setError(json.stored === false ? "Feedback capture isn't set up yet — try again later." : json.error ?? "Something went wrong.");
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeAndReset() {
    setOpen(false);
    setTimeout(() => {
      setSubmitted(false);
      setRating(null);
      setComparableProducts("");
      setMessage("");
      setError(null);
    }, 300);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-4 py-2.5 shadow-lg hover:opacity-90 transition-opacity"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={closeAndReset}>
          <div
            className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {submitted ? (
              <>
                <h3 className="text-sm font-semibold">Thanks — logged.</h3>
                <p className="text-sm text-zinc-500">Your feedback helps shape what gets built next.</p>
                <button onClick={closeAndReset} className="text-sm self-start px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700">
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">Quick feedback</h3>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1.5">How&apos;s your experience been so far?</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(n)}
                        className={`w-9 h-9 rounded-full border text-sm font-medium transition-colors ${
                          rating === n
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                            : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                    <span>Rough</span>
                    <span>Excellent</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1.5">What do you compare this to? (other apps/tools you use)</label>
                  <input
                    value={comparableProducts}
                    onChange={(e) => setComparableProducts(e.target.value)}
                    placeholder="e.g. Seeking Alpha, a spreadsheet, thinkorswim…"
                    className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2.5 py-1.5 bg-transparent"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1.5">Anything else? (optional)</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Suggestions, bugs, confusing bits — anything."
                    className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2.5 py-1.5 bg-transparent resize-none"
                  />
                </div>

                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

                <div className="flex gap-2">
                  <button
                    onClick={submit}
                    disabled={submitting || (rating === null && !comparableProducts.trim() && !message.trim())}
                    className="text-sm px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send feedback"}
                  </button>
                  <button onClick={closeAndReset} className="text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
