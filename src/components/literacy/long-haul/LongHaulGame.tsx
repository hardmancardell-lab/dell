"use client";

import { useEffect, useRef, useState } from "react";
import { ECONOMY, VEHICLE, XP } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import type { LongHaulHud, LongHaulSummary } from "./long-haul-engine";
import { readSoundPreference } from "./long-haul-audio";

// Three.js + Rapier touch window/WebGL/WASM at module-eval time — this
// component is only ever mounted via a next/dynamic ssr:false import, same
// as SaveSpendEarnGame/DeltaDefenderGame elsewhere in this agent.

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 400;
const SPEED_SEGMENTS = 24;
const FUEL_SEGMENTS = 20;
/** The top of the speedometer, in the HUD's own unit (top speed in m/s times 3.2). */
const TOP_MPH = Math.round(VEHICLE.baseMaxSpeed * 3.2);

export function LongHaulGame({ onComplete }: { onComplete: (xpAwarded: number, tookLoan: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<import("./long-haul-engine").LongHaulEngine | null>(null);
  const hasAwardedRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<LongHaulHud>({ speedMph: 0, fuel: 100, tollPaid: 0, trailerAttached: false, debt: 0 });
  const [soundOn, setSoundOn] = useState(() => readSoundPreference());
  const [modalOpen, setModalOpen] = useState(false);
  const [summary, setSummary] = useState<LongHaulSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        const { LongHaulEngine } = await import("./long-haul-engine");
        if (cancelled) return;
        const engine = new LongHaulEngine(container, {
          onHud: (h) => setHud(h),
          onLoanPrompt: () => setModalOpen(true),
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
  }, []);

  function driveAgain() {
    hasAwardedRef.current = false;
    setSummary(null);
    setModalOpen(false);
    engineRef.current?.reset();
  }

  if (status === "error") {
    return (
      <div className="text-sm py-3" style={{ color: "var(--verdict)" }}>
        The Long Haul needs WebGL to run — {error}
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
          tabIndex={0}
          role="application"
          aria-label="The Long Haul driving game. Focus here, then drive with W A S D or the arrow keys, or use the on-screen buttons below. The lessons give the same ideas in text, so this game is optional."
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-control)" }}
        />

        {/* HUD overlay: a small dashboard. The numbers shown are exactly the engine's HUD values. */}
        <div
          style={{
            position: "absolute", top: 10, left: 10, padding: "8px 12px 9px", borderRadius: 10, minWidth: 176,
            background: "rgba(14,19,27,0.78)", border: "1px solid var(--line)", color: "var(--text-0)", fontSize: 11,
            pointerEvents: "none", backdropFilter: "blur(4px)", fontVariantNumeric: "tabular-nums",
          }}
        >
          <div className="flex items-baseline justify-between" style={{ color: "var(--text-2)", letterSpacing: 0.4 }}>
            <span>Speed</span>
            <span style={{ color: "var(--text-0)", fontSize: 26, fontWeight: 600, lineHeight: 1, letterSpacing: 0 }}>{hud.speedMph}</span>
          </div>
          <div style={{ display: "flex", gap: 2, margin: "5px 0 8px" }} aria-hidden="true">
            {Array.from({ length: SPEED_SEGMENTS }, (_, i) => (
              <span
                key={i}
                style={{
                  flex: 1, height: 4, borderRadius: 1,
                  background: i < Math.round((Math.min(hud.speedMph, TOP_MPH) / TOP_MPH) * SPEED_SEGMENTS) ? "var(--signal)" : "var(--ink-700)",
                }}
              />
            ))}
          </div>
          <div className="flex items-baseline justify-between" style={{ color: "var(--text-2)", letterSpacing: 0.4 }}>
            <span>Fuel</span>
            <span style={{ color: hud.fuel < 25 ? "var(--danger)" : hud.fuel < 40 ? "var(--verdict)" : "var(--text-0)", fontSize: 15, fontWeight: 600 }}>{hud.fuel}</span>
          </div>
          <div style={{ display: "flex", gap: 2, margin: "4px 0 8px" }} aria-hidden="true">
            {Array.from({ length: FUEL_SEGMENTS }, (_, i) => (
              <span
                key={i}
                style={{
                  flex: 1, height: 6, borderRadius: 1,
                  background: i < Math.ceil((hud.fuel / 100) * FUEL_SEGMENTS) ? (hud.fuel < 25 ? "var(--danger)" : hud.fuel < 40 ? "var(--verdict)" : "var(--signal)") : "var(--ink-700)",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between" style={{ color: "var(--text-2)" }}><span>Tolls</span><span style={{ color: "var(--text-0)" }}>${hud.tollPaid}</span></div>
          {hud.trailerAttached && (
            <div className="flex justify-between" style={{ color: "var(--verdict)", marginTop: 2 }}><span>Loan owed</span><span>${hud.debt.toFixed(2)}</span></div>
          )}
        </div>

        <div
          style={{
            position: "absolute", bottom: 8, left: 8, right: 8, padding: "5px 9px", borderRadius: 8,
            background: "rgba(14,19,27,0.62)", color: "var(--text-1)", fontSize: 10.5, lineHeight: 1.35, pointerEvents: "none",
            opacity: hud.speedMph > 0 ? 0.55 : 1, transition: "opacity 0.6s",
          }}
        >
          Click or Tab to the game (this also turns the sound on), then WASD / Arrows · left lane = Back Roads (free, rough) · right lane = Highway (toll, smooth)
        </div>

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
                Fuel&apos;s low. This place will fill your tank right now for <strong>${ECONOMY.loanAmount}</strong>, no questions asked.
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
                Taking it refuels you instantly, but attaches a real weight to the car — worse handling, lower top speed — until it&apos;s paid off. If it is not repaid it rolls over, and the ${ECONOMY.loanAmount} loan keeps adding a fee.
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
              <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-0)" }}>Run Complete</h4>
              <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>Time: <strong>{summary.elapsedSeconds.toFixed(1)}s</strong></p>
              <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>
                Tolls paid: <strong>${summary.tollPaid}</strong> {summary.tollPaid > 0 ? "(took the highway)" : "(took the back roads)"}
              </p>
              {summary.tookLoan ? (
                <>
                  <p className="text-xs mb-1" style={{ color: "var(--text-1)" }}>
                    Quick-cash loan taken: <strong>${summary.debt.toFixed(2)} owed</strong> on a ${ECONOMY.loanAmount} loan at {ECONOMY.loanAPR}% APR
                    {summary.rollovers > 0
                      ? ` — it rolled over ${summary.rollovers} time${summary.rollovers === 1 ? "" : "s"}, adding a fee each time, and the $${ECONOMY.loanAmount} you borrowed was never paid down.`
                      : "."}
                  </p>
                  <p className="text-xs mb-3" style={{ color: "var(--verdict)" }}>{ECONOMY.rolloverRateText}</p>
                </>
              ) : (
                <p className="text-xs mb-3" style={{ color: "var(--text-1)" }}>No loan taken — fuel management alone got you to the finish.</p>
              )}
              <button className="jv-btn" onClick={driveAgain}>Drive Again</button>
            </div>
          </div>
        )}
      </div>

      {/* On-screen controls: the same inputs as the keys, for touch, mouse and switch users. */}
      <div role="group" aria-label="Driving controls" className="flex flex-wrap gap-2 mt-2" style={{ display: status === "ready" ? "flex" : "none" }}>
        {([
          ["left", "Steer left"],
          ["right", "Steer right"],
          ["up", "Accelerate"],
          ["down", "Brake"],
        ] as const).map(([control, label]) => (
          <button
            key={control}
            type="button"
            aria-label={label}
            className="jv-btn-outline"
            style={{ touchAction: "none", userSelect: "none" }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engineRef.current?.unlockAudio(); engineRef.current?.setControl(control, true); }}
            onPointerUp={() => engineRef.current?.setControl(control, false)}
            onPointerCancel={() => engineRef.current?.setControl(control, false)}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); engineRef.current?.setControl(control, true); } }}
            onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") engineRef.current?.setControl(control, false); }}
            onBlur={() => engineRef.current?.setControl(control, false)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="jv-btn-outline"
          aria-pressed={soundOn}
          aria-label={soundOn ? "Sound is on. Press to mute." : "Sound is off. Press to turn on."}
          onClick={() => {
            const next = !soundOn;
            engineRef.current?.setSoundEnabled(next);
            setSoundOn(next);
          }}
        >
          {soundOn ? "Sound: on" : "Sound: off"}
        </button>
      </div>

    </div>
  );
}
