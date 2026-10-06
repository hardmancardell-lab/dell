"use client";

import { useEffect, useRef, useState } from "react";
import { ECONOMY, XP } from "@/lib/agents/financial-literacy/skills/long-haul-content";
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

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<LongHaulHud>({ speedMph: 0, speedFrac: 0, fuel: 100, tollPaid: 0, trailerAttached: false, debt: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [summary, setSummary] = useState<LongHaulSummary | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
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
        const engine = new LongHaulEngine(container, CANVAS_WIDTH, CANVAS_HEIGHT, {
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
            background: "rgba(10,12,16,0.6)", color: "var(--text-0)", fontSize: 12, minWidth: 170, pointerEvents: "none",
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
          <div className="flex justify-between"><span>Tolls</span><span>${hud.tollPaid}</span></div>
          {hud.trailerAttached && (
            <div className="flex justify-between" style={{ color: "var(--verdict)" }}><span>Trailer debt</span><span>${hud.debt}</span></div>
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
            background: "rgba(10,12,16,0.5)", color: "var(--text-2)", fontSize: 11, pointerEvents: "none",
          }}
        >
          WASD / Arrows to drive · left lane = Back Roads (free, rough) · right lane = Highway (toll, smooth)
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
                Taking it refuels you instantly, but attaches a real weight to the car — worse handling, lower top speed — until it&apos;s paid off.
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
                    Quick-cash loan taken: <strong>${summary.debt} owed</strong>, {ECONOMY.loanAPR}% APR.
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
    </div>
  );
}
