import { useId, type CSSProperties, type ReactNode } from "react";
import { FayeAvatar, FAYE_MOODS, MOOD_WORD, type FayeMood } from "./FayeAvatar";
import { FayeFullBodyStyles } from "./FayeFullBodyStyles";
import { ASPECT, FAYE_RIG, HEAD, L1, POSES, SHOULDER, VB_H, VB_W, rigVars, solveArm, type ArmSpec, type CharacterRig } from "./CharacterRig";

/**
 * FayeFullBody: Faye as a standing figure. The head is the existing FayeAvatar (the "aperture face"); the body is a
 * stylised, neutral figure in a dark ink-blue structured jacket with teal piping. Procedural inline SVG plus CSS, Jarvis
 * tokens only, no images, no dependencies, no timers, no per-frame JavaScript (animation is CSS transform and opacity).
 *
 * ## Props
 *
 *   mood           "idle" | "listening" | "thinking" | "speaking" | "unsure" | "celebrating" | "offline" | "error"
 *                  Default "idle". The POSE follows the mood, and the face follows it too (same value is passed on).
 *                    idle         calm stance, slow breathing
 *                    listening    head tilts toward you, one hand cupped at the ear
 *                    thinking     hand at the chin, other arm across the waist, small dots orbiting the head
 *                    speaking     one open palm raised, gesturing loosely in time with the mouth
 *                    unsure       small shrug, palms out, head tilted, amber piping
 *                    celebrating  both arms up once, a small hop (no confetti)
 *                    offline      seated on a dock, powered down, dimmed, a standby glyph ("resting")
 *                    error        offline plus the head's small danger marker
 *   height         Pixels tall, clamped to 120..480, default 240. The width is height x 0.6 (fixed aspect).
 *   label          Name used in the accessible name, default "Faye". The name reads "Faye, thinking: one hand at the chin, ...".
 *   decorative     true when text next to it already says the same: renders aria-hidden and no role. Default false.
 *   announce       true to add a visually hidden aria-live="polite" status ("Faye is thinking"), changing on mood change
 *                  only. Use on ONE character per screen.
 *   chunkTick      Speaking only; passed to the head (see FayeAvatar). Bump per streamed chunk so the mouth follows real
 *                  chunk timing. If omitted, the head loops gently while speaking.
 *   reducedMotion  true to force static poses regardless of the OS setting; undefined follows prefers-reduced-motion.
 *   rig            A CharacterRig (token names for skin, jacket, piping...). Default FAYE_RIG. This is how an advisor
 *                  character would reuse the body, poses and stylesheet; see CharacterRig.ts for the options.
 *   className      Extra class on the wrapper.
 *
 * ## Usage
 *
 *   <FayeFullBody mood={busy ? "thinking" : "idle"} height={320} announce />
 *   <FayeFullBody mood="speaking" height={240} chunkTick={chunkCount} />
 *
 * ## Structure and cost
 * Three stacked layers in one fixed 240 x 400 box: the back SVG (pad, legs, torso, neck), the head (an HTML slot holding
 * FayeAvatar, tilted about the neck), and the front SVG (arms and hands, so a hand can sit in front of the face, plus the
 * orbiting dots and the standby glyph). The box never changes size between poses, so there is no layout shift.
 * The wrapper's only role="img" carries the accessible name; every layer inside is aria-hidden. Server-render safe.
 */
export interface FayeFullBodyProps {
  mood?: FayeMood;
  height?: number;
  label?: string;
  decorative?: boolean;
  announce?: boolean;
  chunkTick?: number;
  reducedMotion?: boolean;
  rig?: CharacterRig;
  className?: string;
}

export const FULLBODY_MIN_HEIGHT = 120;
export const FULLBODY_MAX_HEIGHT = 480;

const f = (n: number) => Math.round(n * 100) / 100;

function clampHeight(h: unknown): number {
  const n = typeof h === "number" && Number.isFinite(h) ? h : 240;
  return Math.round(Math.min(FULLBODY_MAX_HEIGHT, Math.max(FULLBODY_MIN_HEIGHT, n)));
}

/** One arm: shoulder cap, upper sleeve, forearm sleeve with a piped cuff, hand. Drawn pointing down, then rotated. */
function Arm({ side, spec, lift, sit, anim, fore, dr }: { side: "L" | "R"; spec: ArmSpec; lift: number; sit: number; anim?: string; fore?: string; dr?: number }) {
  const sx = SHOULDER[side][0];
  const sy = SHOULDER[side][1] + lift + sit;
  const sol = solveArm([sx, sy], spec.target, spec.bend);
  const thumbX = side === "L" ? 8.2 : -8.2;
  const thumbRot = side === "L" ? -18 : 18;
  const style = dr !== undefined ? ({ ["--fb-dr" as string]: `${f(dr)}deg` } as CSSProperties) : undefined;
  return (
    <g transform={`translate(${sx} ${f(sy)})`} data-arm={side}>
      <g className={anim} style={style}>
        <g transform={`rotate(${sol.r1})`}>
          <circle className="fb-sleeve" cx="0" cy="0" r="10.5" />
          <rect className="fb-sleeve" x="-9.5" y="-3" width="19" height={L1 + 6} rx="9.5" />
          <g transform={`translate(0 ${L1})`}>
            <g className={fore}>
              <g transform={`rotate(${sol.r2})`}>
                <rect className="fb-sleeve" x="-9" y="-5" width="18" height="61" rx="9" />
                <circle className="fb-sleeve" cx="0" cy="0" r="9" style={{ stroke: "none" }} />
                <line className="fb-pipe-thin" x1="-9" y1="51" x2="9" y2="51" />
                <g transform={`rotate(${spec.handRot ?? 0} 0 57) translate(0 57) scale(1.25) translate(0 -57)`}>
                  <path className="fb-skin" d="M-7 57 H7 V70 Q7 83 0 84 Q-7 83 -7 70 Z" />
                  <ellipse className="fb-skin" cx={thumbX * 0.8} cy="66" rx="3.4" ry="7.5" transform={`rotate(${thumbRot} ${thumbX * 0.8} 66)`} />
                  {spec.open ? (
                    <g className="fb-fingers">
                      <line className="fb-fgap" x1="-3.2" y1="73" x2="-3.2" y2="83.5" />
                      <line className="fb-fgap" x1="0" y1="74" x2="0" y2="84" />
                      <line className="fb-fgap" x1="3.2" y1="73" x2="3.2" y2="83.5" />
                    </g>
                  ) : null}
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

/** One leg, standing (mirrored for the other side by the caller). */
function StandingLeg() {
  return (
    <>
      <path className="fb-trousers" d="M83 246 Q79 308 88 374 L113 374 Q115 332 120 298 L120 246 Z" />
      <path className="fb-crease" d="M100 268 L100 368" />
      <path className="fb-shoe" d="M86 374 L113 374 L115 385 Q115 391 108 391 L80 391 Q75 391 78 384 Z" />
      <path className="fb-pipe-thin" d="M78 389 L114 389" />
    </>
  );
}

/** One leg, seated: a short thigh toward the viewer, a knee, a shin and a shoe. */
function SeatedLeg() {
  return (
    <>
      <rect className="fb-trousers" x="80" y="288" width="41" height="40" rx="14" />
      <rect className="fb-trousers-shade" x="86" y="320" width="27" height="58" rx="9" />
      <path className="fb-shoe" d="M84 378 L113 378 L115 388 Q115 391 109 391 L80 391 Q76 391 78 386 Z" />
    </>
  );
}

export function FayeFullBody({ mood = "idle", height = 240, label, decorative = false, announce = false, chunkTick, reducedMotion, rig = FAYE_RIG, className }: FayeFullBodyProps): ReactNode {
  const safeMood: FayeMood = FAYE_MOODS.includes(mood) ? mood : "idle";
  const H = clampHeight(height);
  const W = Math.round(H * ASPECT);
  const name = label ?? rig.displayName;
  const pose = POSES[safeMood];
  const uid = useId();
  const gid = "fbg" + uid.replace(/[^A-Za-z0-9]/g, "");
  const word = MOOD_WORD[safeMood];
  const accessibleName = `${name}, ${word}: ${pose.describe}`;
  const sit = pose.sit;

  // The head slot, as a percentage of the fixed box, so it scales with the wrapper.
  const headBoxPx = Math.max(24, Math.round((H * HEAD.box) / VB_H));
  const headStyle: CSSProperties = {
    left: `${f(((HEAD.cx - HEAD.box / 2) / VB_W) * 100)}%`,
    top: `${f(((HEAD.cy - HEAD.box / 2) / VB_H) * 100)}%`,
    width: `${f((HEAD.box / VB_W) * 100)}%`,
    height: `${f((HEAD.box / VB_H) * 100)}%`,
    transformOrigin: "50% 106%",
    transform: `translateY(${f(((sit + pose.head.dy) / HEAD.box) * 100)}%) rotate(${pose.head.tilt}deg)`,
  };

  // Celebrating: the arms rise from rest. The keyframe starts at the rest angle, so it needs the angle between the two.
  const restL = solveArm([SHOULDER.L[0], SHOULDER.L[1]], POSES.idle.L.target, POSES.idle.L.bend);
  const restR = solveArm([SHOULDER.R[0], SHOULDER.R[1]], POSES.idle.R.target, POSES.idle.R.bend);
  const upL = solveArm([SHOULDER.L[0], SHOULDER.L[1]], pose.L.target, pose.L.bend);
  const upR = solveArm([SHOULDER.R[0], SHOULDER.R[1]], pose.R.target, pose.R.bend);
  const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
  const drL = wrap(restL.r1 - upL.r1);
  const drR = wrap(restR.r1 - upR.r1);

  const armAnim = (side: "L" | "R"): { anim?: string; fore?: string; dr?: number } => {
    if (safeMood === "celebrating") return { anim: "fb-cheer", dr: side === "L" ? drL : drR };
    if (safeMood === "unsure") return { anim: "fb-shrug" };
    if (safeMood === "speaking" && side === "R") return { fore: "fb-gest" };
    if (safeMood === "thinking" && side === "R") return { fore: "fb-tap" };
    return {};
  };

  const wrapperStyle: CSSProperties = { width: W, height: H, ...rigVars(rig) };
  const classes = ["fayefb", reducedMotion ? "fb-static" : "", className ?? ""].filter(Boolean).join(" ");
    const hipY = 258 + sit;
  const breathes = safeMood === "idle" || safeMood === "listening" || safeMood === "speaking" || safeMood === "thinking";

  const layerProps = { className: "fb-layer", viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: "xMidYMid meet", "aria-hidden": true, focusable: false } as const;

  return (
    <span className={classes} style={wrapperStyle} data-mood={safeMood} data-pose={pose.seated ? "seated" : "standing"} data-height={H}>
      <FayeFullBodyStyles />
      <span className="fb-stage" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": accessibleName })} data-faye-fullbody="">
        {/* Back layer: pad, dock and legs, torso, neck. */}
        <svg {...layerProps} data-layer="back">
          <defs>
            <linearGradient id={`${gid}j`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="fb-stop-a" />
              <stop offset="1" className="fb-stop-b" />
            </linearGradient>
            <linearGradient id={`${gid}n`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="fb-stop-s2" />
              <stop offset="1" className="fb-stop-s1" />
            </linearGradient>
          </defs>
          <ellipse className="fb-pad" cx="120" cy="391" rx="62" ry="7" />
          <ellipse className="fb-padring" cx="120" cy="391" rx="62" ry="7" />
          <g>
            {pose.seated ? <rect className="fb-dock" x="64" y="300" width="112" height="46" rx="12" /> : null}
            {pose.seated ? <path className="fb-pipe-thin" d="M76 304 H164" /> : null}
            {pose.seated ? (
              <>
                <g data-leg="L">
                  <SeatedLeg />
                </g>
                <g data-leg="R" transform={`translate(${VB_W} 0) scale(-1 1)`}>
                  <SeatedLeg />
                </g>
              </>
            ) : (
              <>
                <g data-leg="L">
                  <StandingLeg />
                </g>
                <g data-leg="R" transform={`translate(${VB_W} 0) scale(-1 1)`}>
                  <StandingLeg />
                </g>
              </>
            )}
            <g transform={`translate(0 ${sit})`}>
              <g transform={`translate(120 258)`}>
                <g className={breathes ? "fb-breathe" : undefined}>
                  <g transform="translate(-120 -258)">
                    <path fill={`url(#${gid}n)`} d="M109 100 H131 L134 126 H106 Z" />
                    <path className="fb-jacket" fill={`url(#${gid}j)`} d="M110 123 Q96 126 84 131 Q73 135 73 147 L77 200 Q79 232 76 258 L120 260 L164 258 Q161 232 163 200 L167 147 Q167 135 156 131 Q144 126 130 123 Z" />
                    <path className="fb-shirt" d="M110 123 L130 123 L120 190 Z" />
                    <path className="fb-lapel" d="M102 124 L120 196 L111 204 L88 152 L95 137 Z" />
                    <path className="fb-lapel" d="M138 124 L120 196 L129 204 L152 152 L145 137 Z" />
                    <path className="fb-pipe" d="M104 125 L120 195" />
                    <path className="fb-pipe" d="M136 125 L120 195" />
                    <path className="fb-pipe-thin" d="M120 198 L120 258" style={{ strokeOpacity: 0.35 }} />
                    <circle className="fb-button" cx="120" cy="206" r="2.6" />
                    <path className="fb-pipe" d="M77 257 L163 257" />
                    <path className="fb-pipe-thin" d="M90 226 L108 226" />
                    <path className="fb-pipe-thin" d="M132 226 L150 226" />
                    <polyline className="fb-pipe-thin" points="136,164 140,168 144,160 148,166 152,162" style={{ strokeWidth: 1.4 }} />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </svg>

        {/* Head slot: the existing aperture face, tilted about the neck. */}
        <span className="fb-head" style={headStyle} data-layer="head">
          <span className={`fb-head-in${breathes ? " fb-bob" : ""}`}>
            <FayeAvatar mood={safeMood} size={headBoxPx} decorative reducedMotion={reducedMotion} chunkTick={chunkTick} />
          </span>
        </span>

        {/* Front layer: arms (a hand can sit in front of the face), orbiting dots, standby glyph. */}
        <svg {...layerProps} data-layer="front">
          <g>
            <g transform={`translate(120 ${hipY})`}>
              <g className={breathes ? "fb-breathe" : undefined}>
                <g transform={`translate(-120 ${-hipY})`}>
                  <Arm side="L" spec={pose.L} lift={pose.lift} sit={sit} {...armAnim("L")} />
                  <Arm side="R" spec={pose.R} lift={pose.lift} sit={sit} {...armAnim("R")} />
                </g>
              </g>
            </g>
          </g>
          {safeMood === "thinking" ? (
            <g transform={`translate(${HEAD.cx} ${HEAD.cy})`} data-orbit="">
              <g className="fb-spin">
                {[
                  { a: -70, r: 2.8, o: 1 },
                  { a: -46, r: 2.2, o: 0.7 },
                  { a: -26, r: 1.6, o: 0.45 },
                ].map((d, i) => (
                  <circle key={i} className="fb-orbit-dot" cx={f(57 * Math.cos((d.a * Math.PI) / 180))} cy={f(57 * Math.sin((d.a * Math.PI) / 180))} r={d.r} opacity={d.o} />
                ))}
              </g>
            </g>
          ) : null}
          {pose.seated ? (
            <g transform={`translate(188 ${74 + sit * 0})`} data-standby="">
              <g className="fb-pulse">
                <path className="fb-standby" d="M-4.6 -4.2 A7 7 0 1 0 4.6 -4.2" />
                <line className="fb-standby" x1="0" y1="-8.5" x2="0" y2="-1.5" />
              </g>
            </g>
          ) : null}
        </svg>
      </span>
      {announce ? (
        <span className="fb-sr" role="status" aria-live="polite">
          {`${name} is ${word}`}
        </span>
      ) : null}
    </span>
  );
}

export default FayeFullBody;
