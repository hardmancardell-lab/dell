"use client";

import { useEffect, useState } from "react";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import { useTrackEvent } from "@/lib/analytics/use-track";

// Persisted per-browser, same convention as this app's other localStorage-only
// state (watchlist, portfolio holdings) — a real account-level "have they
// seen this" flag would need a DB column, which doesn't exist for onboarding
// and isn't worth adding just for a skippable one-time tour.
const STORAGE_KEY = "dellegate-onboarding-completed";

type GoalId = "longterm" | "trading" | "track" | "learn";

interface Goal {
  id: GoalId;
  label: string;
  description: string;
  primaryId: string;
  tip: string;
}

// primaryId values match the real top-level Tabs ids in page.tsx exactly
// (top-down/trading/portfolio/literacy) — this only ever routes to a
// PRIMARY tab, not a secondary/tertiary one, since navLevel="secondary" is
// only wired for Trading Agent's own secondary Tabs today; naming the
// specific sub-tab in the tip text instead of trying to deep-link into every
// destination keeps this reliable without extending that wiring further.
const GOALS: Goal[] = [
  {
    id: "longterm",
    label: "Research stocks for a long-term hold",
    description: "A real value-investing checklist, sector reads, and macro context — not day-trade signals.",
    primaryId: "top-down",
    tip: "Start on Macro for the overall backdrop, then Sector, then run a specific company through Security Analysis's value checklist.",
  },
  {
    id: "trading",
    label: "Find active trading setups",
    description: "Backtested signals, options tools, and calendar-effect studies — real data, real stats, no invented numbers.",
    primaryId: "trading",
    tip: "Guided Signals shows what's live right now, already backtested with real significance testing — that's the fastest starting point.",
  },
  {
    id: "track",
    label: "Track and rebalance a portfolio",
    description: "Manual holdings tracker with real live valuations, allocation targets (per-symbol and per-asset-class), and rebalancing math.",
    primaryId: "portfolio",
    tip: "Add your holdings on Dashboard first, then use Risk & Rebalancing to set targets — including a whole-portfolio target like \"60% bonds,\" not just per-symbol.",
  },
  {
    id: "learn",
    label: "Learn the basics first",
    description: "Real gamified modules by skill tier — not another quiz.",
    primaryId: "literacy",
    tip: "Pick your tier (Beginner/Intermediate/Expert) and start with the first module — each one is a real game, not a multiple-choice quiz.",
  },
];

type Step = "welcome" | "goal" | "tip";

export function OnboardingWizard() {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default true until localStorage check resolves, avoids a flash on every load
  const [step, setStep] = useState<Step>("welcome");
  const [chosenId, setChosenId] = useState<GoalId | null>(null);
  const nav = useAppNavigation();
  const { track } = useTrackEvent();

  useEffect(() => {
    try {
      setDismissed(Boolean(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // localStorage blocked (private window, some corporate policies) — a
      // wizard that can't remember being dismissed would just re-show every
      // load, worse than not showing it at all.
      setDismissed(true);
    } finally {
      setHydrated(true);
    }
  }, []);

  function finish(reason: "skipped" | "completed") {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Nothing to fall back to here — if it can't be written, the wizard
      // will just show again next load, which is a real, disclosed
      // limitation rather than a crash.
    }
    track("onboarding_wizard_dismissed", { tab: "Onboarding", metadata: { reason, chosenGoal: chosenId } });
    setDismissed(true);
  }

  function goToChosenTab() {
    const goal = GOALS.find((g) => g.id === chosenId);
    if (goal) nav.navigateTo(goal.primaryId);
    finish("completed");
  }

  if (!hydrated || dismissed) return null;

  const chosen = GOALS.find((g) => g.id === chosenId) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div className="jarvis" style={{ maxWidth: 480, width: "100%" }}>
        <div className="jv-card" style={{ padding: 24 }}>
          {step === "welcome" && (
            <>
              <h2 className="jv-title" style={{ fontSize: 20, marginBottom: 8 }}>Welcome to Dellegate</h2>
              <p className="jv-lede" style={{ marginBottom: 20 }}>
                Real market data, real backtests, no fabricated numbers. Five sections: <strong>Research Agent</strong>{" "}
                (macro → sector → company analysis), <strong>Trading Agent</strong> (signals, backtests, options),{" "}
                <strong>Portfolio Tracker</strong> (holdings, allocation targets, rebalancing),{" "}
                <strong>Financial Literacy</strong> (gamified learning), and an <strong>Assistant</strong> that answers
                questions using this app&apos;s own live tools.
              </p>
              <div className="flex items-center justify-between">
                <button onClick={() => finish("skipped")} className="jv-btn-outline">Skip tour</button>
                <button onClick={() => setStep("goal")} className="jv-btn">What are you here to do? →</button>
              </div>
            </>
          )}

          {step === "goal" && (
            <>
              <h2 className="jv-title" style={{ fontSize: 20, marginBottom: 16 }}>What are you here to do?</h2>
              <div className="flex flex-col gap-2 mb-4">
                {GOALS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setChosenId(g.id);
                      setStep("tip");
                    }}
                    className="jv-card text-left"
                    style={{ padding: 12, cursor: "pointer" }}
                  >
                    <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{g.label}</div>
                    <div className="text-xs" style={{ color: "var(--text-2)" }}>{g.description}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => finish("skipped")} className="jv-btn-outline">Skip tour</button>
            </>
          )}

          {step === "tip" && chosen && (
            <>
              <h2 className="jv-title" style={{ fontSize: 20, marginBottom: 8 }}>Good place to start</h2>
              <p className="jv-lede" style={{ marginBottom: 20 }}>{chosen.tip}</p>
              <div className="flex items-center justify-between">
                <button onClick={() => setStep("goal")} className="jv-btn-outline">← Back</button>
                <button onClick={goToChosenTab} className="jv-btn">Take me there</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
