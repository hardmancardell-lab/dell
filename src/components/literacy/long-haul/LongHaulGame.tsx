"use client";

import { useEffect, useRef, useState } from "react";
import { CAR_MODELS, ECONOMY, SHIFT, XP } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import type { LongHaulHud, LongHaulSummary } from "./long-haul-engine";

// Three.js + Rapier touch window/WebGL/WASM at module-eval time — this
// component is only ever mounted via a next/dynamic ssr:false import, same
// as SaveSpendEarnGame/DeltaDefenderGame elsewhere in this agent.

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 400;

export function LongHaulGame({ onComplete }: { onComplete: (xpAwarded: number, tookLoan: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<import("./long-haul-engine").LongHaulEngine | null>(null);
  const hasAwardedRef = useRef(false);

  const [carModelId, setCarModelId] = useState<string | null>(null);
  const [status, setStatus] = useState<"picking" | "loading" | "ready" | "error">("picking");
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<LongHaulHud>({
    speedMph: 0,
    speedFrac: 0,
    fuel: 100,
    cashEarned: 0,
    cashGoal: SHIFT.cashGoal,
    trailerAttached: false,
    debt: 0,
    fareInstruction: "",
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [summary, setSummary] = useState<LongHaulSummary | null>(null);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Deliberately keyed on carModelId alone, NOT status: this effect's own
    // async work calls setStatus("ready")/setStatus("error") below, and if
    // status were a dependency here, that write would make React re-run this
    // effect's cleanup (disposing the engine we just built) immediately after
    // creating it — the engine would init, start its render loop, and get
    // torn down again within the same tick. Confirmed by a frozen simulation
    // (fuel/position never advanced) with window.__qaDrive/__qaState still
    // pointing at the disposed instance.
    if (!carModelId) return;
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        const { LongHaulEngine } = await import("./long-haul-engine");
        if (cancelled) return;
        // The wrapper around `container` is display:none until status flips
        // to "ready" (below), so if the engine measures container.clientWidth/
        // Height at construction time it reads 0x0 and the renderer never
        // recovers — confirmed by actually loading this in a browser: the
        // canvas existed but was 0x0 and nothing ever painted. Passing the
        // known fixed size explicitly removes the race instead of patching
        // around display timing.
        const engine = new LongHaulEngine(container, CANVAS_WIDTH, CANVAS_HEIGHT, carModelId, {
          onHud: (h) => setHud(h),
          onLoanPrompt: () => setModalOpen(true),
          onFareComplete: (label, payout) => {
            setToast(`+$${payout} — ${label.replace(/^Fare \d+ — /, "")}`);
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToast(null), 2200);
          },
          onFinish: (s) => {
            setSummary(s);
            if (!hasAwardedRef.current) {
              hasAwardedRef.current = true;
              onComplete(s.tookLoan ? XP.onFinishWithLoan : XP.onCleanFinish, s.tookLoan);
            }
          },
        });
        engineRef.current = engine;
        await engine.init();
        if (cancelled) {
          engine.dispose();
          return;
        }
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error.");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carModelId]);

  function driveAgain() {
    hasAwardedRef.current = false;
    setSummary(null);
    setModalOpen(false);
    engineRef.current?.reset();
  }

  function pickCarAndStart(id: string) {
    setCarModelId(id);
    setStatus("loading");
  }

  function changeCar() {
    engineRef.current?.dispose();
    engineRef.current = null;
    setSummary(null);
    setModalOpen(false);
    setCarModelId(null);
    setStatus("picking");
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      engineRef.current?.setMuted(next);
      return next;
    });
  }

  // Semicircle speedometer, 0 at left (180°) to max at right (0°) — see
  // long-haul-engine.ts's onHud callback for speedFrac.
  const ARC_RADIUS = 40;
  const ARC_LENGTH = Math.PI * ARC_RADIUS;
  const needleAngleRad = ((180 - hud.speedFrac * 180) * Math.PI) / 180;
  const needleX = 50 + 32 * Math.cos(needleAngleRad);
  const needleY = 50 - 32 * Math.sin(needleAngleRad);

  if (status === "error") {
    return (
      <div className="text-sm py-3" style={{ color: "var(--verdict)" }}>
        The Long Haul needs WebGL to run — {error}
      </div>
    );
  }

  if (status === "picking") {
    return (
      <div className="jv-card" style={{ maxWidth: CANVAS_WIDTH }}>
        <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>Pick your car</div>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Four stylized classics — handling varies a little by body style, not just paint.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CAR_MODELS.map((car) => (
            <button
              key={car.id}
              onClick={() => pickCarAndStart(car.id)}
              className="text-left rounded-lg p-3"
              style={{ background: "var(--ink-800)", border: "1px solid var(--line)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: `#${car.color.toString(16).padStart(6, "0")}`, display: "inline-block" }} />
                <span className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{car.label}</span>
              </div>
              <div className="text-xs" style={{ color: "var(--text-2)" }}>{car.blurb}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {status === "loading" && (
        <div className="text-sm py-6" style={{ color: "var(--text-2)" }}>Loading the road…</div>
      )}
      <div style={{ position: "relative", width: CANVAS_WIDTH, maxWidth: "100%", display: status === "ready" ? "block" : "none" }}>
        <div
          ref={containerRef}
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}
        />

        {/* Speed-sensation vignette — darkens and tightens toward the edges as
            speed climbs, a standard arcade-racer cue a static camera alone
            can't convey. Pure CSS, no post-processing pipeline needed. */}
        <div
          style={{
            position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 8,
            boxShadow: `inset 0 0 ${40 + hud.speedFrac * 90}px ${8 + hud.speedFrac * 18}px rgba(0,0,0,${0.15 + hud.speedFrac * 0.4})`,
            transition: "box-shadow 0.15s linear",
          }}
        />

        {/* HUD overlay */}
        <div
          style={{
            position: "absolute", top: 10, left: 10, padding: "8px 12px", borderRadius: 8,
            background: "rgba(10,12,16,0.6)", color: "var(--text-0)", fontSize: 12, minWidth: 180, pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <svg viewBox="0 0 100 58" width={90} height={52}>
              <path d="M10,50 A40,40 0 0 1 90,50" fill="none" stroke="var(--ink-700)" strokeWidth={6} strokeLinecap="round" />
              <path
                d="M10,50 A40,40 0 0 1 90,50"
                fill="none"
                stroke={hud.speedFrac > 0.85 ? "var(--verdict)" : "var(--signal)"}
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={ARC_LENGTH}
                strokeDashoffset={ARC_LENGTH * (1 - hud.speedFrac)}
                style={{ transition: "stroke-dashoffset 0.1s linear" }}
              />
              <line x1={50} y1={50} x2={needleX} y2={needleY} stroke="var(--text-0)" strokeWidth={2} strokeLinecap="round" />
              <circle cx={50} cy={50} r={3} fill="var(--text-0)" />
              <text x={50} y={44} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text-0)">
                {hud.speedMph}
              </text>
            </svg>
            <div style={{ fontSize: 10, color: "var(--text-2)" }}>mph</div>
          </div>
          <div className="flex justify-between"><span>Fuel</span><span>{hud.fuel}</span></div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--ink-700)", overflow: "hidden", margin: "4px 0 6px" }}>
            <div style={{ height: "100%", width: `${hud.fuel}%`, background: hud.fuel < 40 ? "var(--verdict)" : "var(--signal)" }} />
          </div>
          <div className="flex justify-between"><span>Earned</span><span>${hud.cashEarned} / ${hud.cashGoal}</span></div>
          {hud.trailerAttached && (
            <div className="flex justify-between" style={{ color: "var(--verdict)" }}><span>Loan debt</span><span>${hud.debt}</span></div>
          )}
        </div>

        <button
          onClick={toggleMute}
          className="jv-btn-outline"
          style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", fontSize: 11 }}
        >
          Sound: {muted ? "Off" : "On"}
        </button>

        <div
          style={{
            position: "absolute", bottom: 10, left: 10, padding: "6px 10px", borderRadius: 8,
            background: "rgba(10,12,16,0.5)", color: "var(--text-0)", fontSize: 11, pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>{hud.fareInstruction}</div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>WASD / Arrows to drive · teal beacon = pickup · gold beacon = dropoff</div>
        </div>

        {toast && (
          <div
            style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              padding: "6px 14px", borderRadius: 999, background: "var(--signal)", color: "#04201c",
              fontSize: 12, fontWeight: 700, pointerEvents: "none",
            }}
          >
            {toast}
          </div>
        )}

        {modalOpen && (
          <div
            style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(5,6,8,0.72)",
            }}
          >
            <div className="jv-card" style={{ maxWidth: 340 }}>
              <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-0)" }}>Quick Cash — gas station</h4>
              <p className="text-xs mb-2" style={{ color: "var(--text-1)" }}>
                Fuel won&apos;t get you through the rest of this shift. This place will fill your tank right now for{" "}
                <strong>${ECONOMY.loanAmount}</strong>, no questions asked.
              </p>
              <p className="text-xs mb-3" style={{ color: "var(--text-1)" }}>
                APR: <strong style={{ color: "var(--verdict)" }}>{ECONOMY.loanAPR}%</strong> — a real, typical storefront
                payday-loan rate, disclosed the way the Truth in Lending Act requires.
              </p>
              <div className="flex gap-3 mb-2">
                <button
                  className="jv-btn-outline"
                  onClick={() => { engineRef.current?.declineLoan(); setModalOpen(false); }}
                >
                  Keep driving
                </button>
                <button
                  className="jv-btn"
                  onClick={() => { engineRef.current?.acceptLoan(); setModalOpen(false); }}
                >
                  Take it — refuel now
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-2)" }}>
                Taking it refuels you instantly, but attaches a real weight to the car — worse handling, lower top
                speed — until it&apos;s paid off. Declining means limping the rest of the way on empty — slow, but
                free.
              </p>
            </div>
          </div>
        )}

        {summary && (
          <div
            style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(5,6,8,0.72)",
            }}
          >
            <div className="jv-card" style={{ maxWidth: 340 }}>
              <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-0)" }}>Shift Complete</h4>
              <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>Time: <strong>{summary.elapsedSeconds.toFixed(1)}s</strong></p>
              <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>
                Fares completed: <strong>{summary.faresCompleted} of {summary.faresTotal}</strong>
              </p>
              <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>
                Earned: <strong>${summary.cashEarned}</strong> of a ${summary.cashGoal} goal
              </p>
              {summary.tookLoan ? (
                <>
                  <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>
                    Quick-cash loan taken: <strong>${summary.debt} owed</strong>, {ECONOMY.loanAPR}% APR.
                  </p>
                  <p className="text-xs mb-1" style={{ color: "var(--verdict)" }}>{ECONOMY.rolloverRateText}</p>
                  <p className="text-xs mb-3" style={{ color: "var(--text-1)" }}>
                    Net take-home: <strong>${Math.max(0, summary.cashEarned - summary.debt)}</strong> after paying the loan back.
                  </p>
                </>
              ) : (
                <p className="text-xs mb-3" style={{ color: "var(--text-1)" }}>No loan taken — fuel management alone covered the whole shift.</p>
              )}
              <div className="flex gap-3">
                <button className="jv-btn" onClick={driveAgain}>Drive Again</button>
                <button className="jv-btn-outline" onClick={changeCar}>Change Car</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
