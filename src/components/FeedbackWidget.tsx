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
    <div className="jarvis" style={{ background: "none", padding: 0, borderRadius: 0 }}>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 text-sm font-medium px-4 py-2.5 shadow-lg hover:opacity-90 transition-opacity"
        style={{ borderRadius: 9999, background: "var(--signal)", color: "var(--ink-950)" }}
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={closeAndReset}>
          <div
            className="w-full max-w-sm p-5 flex flex-col gap-4"
            style={{ background: "var(--ink-900)", border: "1px solid var(--line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {submitted ? (
              <>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>Thanks — logged.</h3>
                <p className="text-sm" style={{ color: "var(--text-1)" }}>Your feedback helps shape what gets built next.</p>
                <button onClick={closeAndReset} className="jv-btn-outline self-start">
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>Quick feedback</h3>

                <div>
                  <label className="jv-label" style={{ display: "block" }}>How&apos;s your experience been so far?</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(n)}
                        className="w-9 h-9 rounded-full border text-sm font-medium transition-colors"
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
                  <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--text-2)" }}>
                    <span>Rough</span>
                    <span>Excellent</span>
                  </div>
                </div>

                <div>
                  <label className="jv-label" style={{ display: "block" }}>What do you compare this to? (other apps/tools you use)</label>
                  <input
                    value={comparableProducts}
                    onChange={(e) => setComparableProducts(e.target.value)}
                    placeholder="e.g. Seeking Alpha, a spreadsheet, thinkorswim…"
                    className="jv-input w-full"
                  />
                </div>

                <div>
                  <label className="jv-label" style={{ display: "block" }}>Anything else? (optional)</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Suggestions, bugs, confusing bits — anything."
                    className="jv-input w-full resize-none"
                  />
                </div>

                {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

                <div className="flex gap-2">
                  <button
                    onClick={submit}
                    disabled={submitting || (rating === null && !comparableProducts.trim() && !message.trim())}
                    className="jv-btn"
                    style={{ padding: "6px 12px" }}
                  >
                    {submitting ? "Sending…" : "Send feedback"}
                  </button>
                  <button onClick={closeAndReset} className="jv-btn-outline">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
