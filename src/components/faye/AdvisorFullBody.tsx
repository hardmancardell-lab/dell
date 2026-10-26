import { useId, type CSSProperties, type ReactNode } from "react";
import { hash32, type FayeMood } from "./FayeAvatar";
import { AdvisorFullBodyStyles } from "./AdvisorFullBodyStyles";
import {
  ADVISOR_POSES,
  ADVISOR_POSE_NAMES,
  ASPECT,
  HEAD,
  L1,
  SHOULDER,
  VB_H,
  VB_W,
  advisorDefault,
  advisorRig,
  rigVars,
  solveArm,
  type AdvisorFrame,
  type AdvisorHairColour,
  type AdvisorPose,
  type AdvisorSkin,
  type AdvisorSuit,
  type ArmSpec,
  type CharacterRig,
  type GlassesStyle,
  type HairStyle,
} from "./CharacterRig";

/**
 * AdvisorFullBody: the advisor (the owner's self-portrait) as a standing figure, built on the same CharacterRig, arm
 * solver and 240 x 400 box as FayeFullBody. She is a person: medium-deep brown skin, a full natural afro, glasses, a
 * tailored pantsuit with an ivory blouse and blush flats, and a real face (eyes, brows, a smile). Faye is an AI assistant
 * with an aperture ring for a face, so the two read as two different characters side by side.
 * Procedural inline SVG plus CSS, tokens only (Jarvis plus the CHARACTER palette in tokens.ts), no images, no
 * dependencies, no timers, no per-frame JavaScript (animation is CSS transform and opacity).
 *
 * ## Props
 *
 *   pose           "idle" | "listening" | "thinking" | "speaking" | "presenting" | "unsure" | "celebrating"   (default "idle")
 *                    idle         relaxed and confident, slow breathing, an occasional blink
 *                    listening    one hand at the ear, head tilted toward you
 *                    thinking     hand at the chin, other arm across the waist, eyes up and to the side
 *                    speaking     one open palm raised, the mouth moving gently
 *                    presenting   one arm out to the side toward a small chart (her advisor role)
 *                    unsure       a small shrug, palms out
 *                    celebrating  both arms up once, a small hop, eyes closed in a grin
 *   mood           A FayeMood, so the same value that drives Faye can drive her. Used only when `pose` is not given.
 *                  idle, listening, thinking, speaking, unsure and celebrating map to the pose of that name;
 *                  offline and error map to idle (a person does not power down).
 *   height         Pixels tall, clamped to 120..480, default 240. Width is height x 0.6 (fixed aspect).
 *   label          Name in the accessible name, default "Advisor": "Advisor, presenting: one arm out toward a chart".
 *   decorative     true when text beside it already says the same: aria-hidden, no role. Default false.
 *   announce       true to add a visually hidden aria-live="polite" status ("Advisor is presenting"). Use on ONE per screen.
 *   reducedMotion  true to force static poses; undefined follows prefers-reduced-motion.
 *   className      Extra class on the wrapper.
 *   chart          Presenting only: draw the small chart card the arm points at (default true).
 *
 * The owner's choices (each optional, each a prop; omitted means the advisorDefault preset):
 *   skin           "fair" | "tan" | "medium" | "mediumDeep" | "deep"          default "mediumDeep"
 *   suit           "plum" | "teal" | "amber"                                  default "plum"
 *   hairStyle      "afro" (full and round) | "afroTapered" (smaller, closer)  default "afro"
 *   hairColour     "black" | "espresso" | "chestnut"                          default "espresso"
 *   glasses        "softRect" | "round" | "none"                              default "softRect"
 *   frame          "rose" | "gold" | "ivory"                                  default "rose"
 *   rig            A CharacterRig to start from (default advisorDefault); the choice props above are applied on top of it.
 *
 * ## Usage
 *
 *   <AdvisorFullBody pose="presenting" height={320} />
 *   <AdvisorFullBody mood={busy ? "thinking" : "idle"} suit="teal" skin="deep" announce />
 *   See AgentTrio (AgentTrio.tsx) for Faye, the advisor and Claude's mark side by side.
 *
 * ## Structure and cost
 * Three stacked layers in one fixed box: the back SVG (pad, trousers, flats, neck, jacket), the head (an HTML slot holding
 * an SVG head: afro, face, glasses; tilted about the neck) and the front SVG (arms and hands, the chart). The box never
 * changes size between poses, so there is no layout shift. The wrapper's only role="img" carries the accessible name.
 */
export interface AdvisorFullBodyProps {
  pose?: AdvisorPose;
  mood?: FayeMood;
  height?: number;
  label?: string;
  decorative?: boolean;
  announce?: boolean;
  reducedMotion?: boolean;
  className?: string;
  chart?: boolean;
  skin?: AdvisorSkin;
  suit?: AdvisorSuit;
  hairStyle?: Exclude<HairStyle, "none">;
  hairColour?: AdvisorHairColour;
  glasses?: GlassesStyle;
  frame?: AdvisorFrame;
  rig?: CharacterRig;
}

export const ADVISOR_MIN_HEIGHT = 120;
export const ADVISOR_MAX_HEIGHT = 480;

const f = (n: number) => Math.round(n * 100) / 100;

function clampHeight(h: unknown): number {
  const n = typeof h === "number" && Number.isFinite(h) ? h : 240;
  return Math.round(Math.min(ADVISOR_MAX_HEIGHT, Math.max(ADVISOR_MIN_HEIGHT, n)));
}

/** The word used in the accessible name and the live region. */
export const ADVISOR_POSE_WORD: Record<AdvisorPose, string> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  presenting: "presenting",
  unsure: "unsure",
  celebrating: "celebrating",
};

const MOOD_TO_POSE: Record<FayeMood, AdvisorPose> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  unsure: "unsure",
  celebrating: "celebrating",
  offline: "idle",
  error: "idle",
};

/** Resolve the pose from `pose`, else `mood`, else idle. Unknown values fall back to idle. */
export function resolveAdvisorPose(pose?: unknown, mood?: unknown): AdvisorPose {
  if (typeof pose === "string" && (ADVISOR_POSE_NAMES as readonly string[]).includes(pose)) return pose as AdvisorPose;
  if (typeof mood === "string" && Object.prototype.hasOwnProperty.call(MOOD_TO_POSE, mood)) return MOOD_TO_POSE[mood as FayeMood];
  return "idle";
}

// ------------------------------------------------------------------------------------------------------ the face
interface FaceSpec {
  eyes: "open" | "happy";
  gaze: [number, number];
  mouth: "smile" | "open" | "grin" | "smirk" | "wave";
  /** Brow lift, negative is up (viewBox units), left and right. */
  browL: number;
  browR: number;
  /** Inner-end lift for a worried brow (unsure). */
  worry: number;
}

const FACES: Record<AdvisorPose, FaceSpec> = {
  idle: { eyes: "open", gaze: [0, 0], mouth: "smile", browL: 0, browR: 0, worry: 0 },
  listening: { eyes: "open", gaze: [-1.2, 0.4], mouth: "smile", browL: -0.8, browR: -0.8, worry: 0 },
  thinking: { eyes: "open", gaze: [1.5, -1.5], mouth: "smirk", browL: 0, browR: -2, worry: 0 },
  speaking: { eyes: "open", gaze: [0, 0], mouth: "open", browL: -0.5, browR: -0.5, worry: 0 },
  presenting: { eyes: "open", gaze: [1.6, 0], mouth: "smile", browL: -1, browR: -1.4, worry: 0 },
  unsure: { eyes: "open", gaze: [-1, 0.8], mouth: "wave", browL: -0.5, browR: -0.5, worry: 2.4 },
  celebrating: { eyes: "happy", gaze: [0, 0], mouth: "grin", browL: -1.6, browR: -1.6, worry: 0 },
};

const EYE_L = 43;
const EYE_R = 67;
const EYE_Y = 66;

/** Circles of the afro in head-local units (110 x 110 box, face centre (55, 64)). Round and full, scalloped at the edge. */
export function afroCircles(style: HairStyle): { cx: number; cy: number; r: number }[] {
  if (style === "none") return [];
  const tapered = style === "afroTapered";
  const R = tapered ? 29 : 40;
  const base = tapered ? 31 : 42;
  const k = tapered ? 0.8 : 1;
  const radii = [15.5, 15, 15.5, 15, 15.5, 14.5];
  const out = [{ cx: 55, cy: 52, r: base }];
  [0, 26, 52, 78, 104, 130].forEach((off, i) => {
    for (const s of off === 0 ? [1] : [-1, 1]) {
      const a = ((-90 + s * off) * Math.PI) / 180;
      out.push({ cx: f(55 + R * Math.cos(a)), cy: f(52 + R * Math.sin(a)), r: f(radii[i] * k) });
    }
  });
  return out;
}

function Eye({ cx, face }: { cx: number; face: FaceSpec }) {
  if (face.eyes === "happy") return <path className="ab-lid" d={`M${cx - 5} ${EYE_Y + 1} Q${cx} ${EYE_Y - 5.5} ${cx + 5} ${EYE_Y + 1}`} style={{ strokeWidth: 2 }} />;
  const gx = cx + face.gaze[0];
  const gy = EYE_Y + face.gaze[1];
  return (
    <g>
      <ellipse className="ab-eye-white" cx={cx} cy={EYE_Y} rx="5.2" ry="4.4" />
      <ellipse className="ab-iris" cx={f(gx)} cy={f(gy)} rx="3" ry="3.5" />
      <circle className="ab-glint" cx={f(gx + 1)} cy={f(gy - 1.2)} r="0.95" />
      <path className="ab-lid" d={`M${cx - 5.4} ${EYE_Y - 0.4} Q${cx} ${EYE_Y - 6} ${cx + 5.4} ${EYE_Y - 0.4}`} />
    </g>
  );
}

function Mouth({ kind }: { kind: FaceSpec["mouth"] }) {
  switch (kind) {
    case "open":
      return (
        <g className="ab-talk">
          <path className="ab-mouth" d="M47 81.5 Q55 80.5 63 81.5 Q61 90.5 55 90.5 Q49 90.5 47 81.5 Z" />
          <path className="ab-teeth" d="M48.2 82 Q55 81.2 61.8 82 Q61 84.6 55 84.6 Q49 84.6 48.2 82 Z" />
          <path className="ab-lipline" d="M47 81.5 Q55 80.5 63 81.5 Q61 90.5 55 90.5 Q49 90.5 47 81.5 Z" />
        </g>
      );
    case "grin":
      return (
        <g>
          <path className="ab-mouth" d="M44.5 80.5 Q55 79.5 65.5 80.5 Q62 94 55 94 Q48 94 44.5 80.5 Z" />
          <path className="ab-teeth" d="M46 81.4 Q55 80.6 64 81.4 Q62.6 86 55 86 Q47.4 86 46 81.4 Z" />
          <path className="ab-lipline" d="M44.5 80.5 Q55 79.5 65.5 80.5 Q62 94 55 94 Q48 94 44.5 80.5 Z" />
        </g>
      );
    case "smirk":
      return <path className="ab-lipline" d="M47 82.5 Q54 85.5 63 80.5" style={{ strokeWidth: 2.3 }} />;
    case "wave":
      return <path className="ab-lipline" d="M47 83.5 Q51 80.8 55 83.2 T63 82.8" style={{ strokeWidth: 2.1 }} />;
    default:
      return <path className="ab-lips" d="M46 81.5 Q50.5 79.8 55 81.2 Q59.5 79.8 64 81.5 Q55 90.5 46 81.5 Z" />;
  }
}

function Glasses({ style }: { style: GlassesStyle }) {
  if (style === "none") return null;
  const lens = (cx: number) =>
    style === "round" ? <circle className="ab-frame" cx={cx} cy={EYE_Y} r="10" /> : <rect className="ab-frame" x={cx - 10.5} y={EYE_Y - 8.5} width="21" height="17" rx="6.2" />;
  const fill = (cx: number) => (style === "round" ? <circle className="ab-lens" cx={cx} cy={EYE_Y} r="10" /> : <rect className="ab-lens" x={cx - 10.5} y={EYE_Y - 8.5} width="21" height="17" rx="6.2" />);
  return (
    <g data-glasses={style}>
      {fill(EYE_L)}
      {fill(EYE_R)}
      {lens(EYE_L)}
      {lens(EYE_R)}
      <path className="ab-frame" d={`M${EYE_L + 10} ${EYE_Y - 3} Q55 ${EYE_Y - 5.4} ${EYE_R - 10} ${EYE_Y - 3}`} />
      <path className="ab-frame" d={`M${EYE_L - 10.4} ${EYE_Y - 3.5} L27 ${EYE_Y - 2.5}`} style={{ strokeWidth: 1.6 }} />
      <path className="ab-frame" d={`M${EYE_R + 10.4} ${EYE_Y - 3.5} L83 ${EYE_Y - 2.5}`} style={{ strokeWidth: 1.6 }} />
      <path className="ab-lens-glint" d={`M${EYE_L - 6.5} ${EYE_Y - 4.5} L${EYE_L - 3} ${EYE_Y - 7.6}`} />
      <path className="ab-lens-glint" d={`M${EYE_R - 6.5} ${EYE_Y - 4.5} L${EYE_R - 3} ${EYE_Y - 7.6}`} />
    </g>
  );
}

const CURLS: [number, number][] = [
  [18, 40], [14, 56], [20, 26], [34, 12], [52, 8], [72, 10], [88, 22], [94, 40], [91, 57], [30, 22], [78, 24], [24, 70], [86, 70], [60, 20], [44, 18],
];

function Head({ gid, rig, pose, blinkOffset }: { gid: string; rig: CharacterRig; pose: AdvisorPose; blinkOffset: string }) {
  const face = FACES[pose];
  const circles = afroCircles(rig.hair.style);
  const reach = rig.hair.style === "afroTapered" ? 34 : 44;
  const fringeR = rig.hair.style === "afroTapered" ? 7.8 : 8.5;
  const fringe = [40, 56, 73, 90, 107, 124, 140].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { cx: f(55 + 25 * Math.cos(a)), cy: f(64 - 31 * Math.sin(a)), r: fringeR };
  });
  const browL = `M35.5 ${f(55.6 + face.browL)} Q43 ${f(51.6 + face.browL - face.worry * 0.4)} 50.5 ${f(54.6 + face.browL - face.worry)}`;
  const browR = `M74.5 ${f(55.6 + face.browR)} Q67 ${f(51.6 + face.browR - face.worry * 0.4)} 59.5 ${f(54.6 + face.browR - face.worry)}`;
  return (
    <svg viewBox="0 0 110 110" aria-hidden="true" focusable="false" data-head={rig.hair.style}>
      <defs>
        <linearGradient id={`${gid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.5" className="ab-stop-s2" />
          <stop offset="1" className="ab-stop-s1" />
        </linearGradient>
      </defs>
      {/* hair behind the face: outline pass, fill pass, sheen and curls */}
      <g data-hair="back">
        {circles.map((c, i) => (
          <circle key={`e${i}`} className="ab-hair-edge" cx={c.cx} cy={c.cy} r={c.r} />
        ))}
        {circles.map((c, i) => (
          <circle key={`h${i}`} className="ab-hair" cx={c.cx} cy={c.cy} r={c.r} />
        ))}
        {rig.hair.style === "afro" ? (
          <>
            <path className="ab-sheen" d="M27.8 39.3 A30 30 0 0 1 40.9 25.5" style={{ strokeWidth: 2.6 }} />
            <path className="ab-sheen" d="M22 48 A36 36 0 0 1 28 36" style={{ strokeWidth: 1.8, strokeOpacity: 0.35 }} />
            <path className="ab-sheen" d="M71.5 23.4 A33 33 0 0 1 82 33.1" style={{ strokeWidth: 2, strokeOpacity: 0.32 }} />
          </>
        ) : (
          <path className="ab-sheen" d="M33 40 A24 24 0 0 1 44 29" style={{ strokeWidth: 2.4 }} />
        )}
        {CURLS.filter(([x, y]) => Math.hypot(x - 55, y - 52) <= reach).map(([x, y], i) => (
          <path key={i} className="ab-curl" d={`M${x - 2.2} ${y + 1} q2.2 -3.4 4.4 0`} transform={`rotate(${(i * 47) % 120 - 60} ${x} ${y})`} style={{ strokeWidth: 1.1 }} />
        ))}
      </g>

      {/* ears, studs, face, features, glasses, hairline: one group, enlarged 10% about the face centre so the face reads at 160 px */}
      <g transform="translate(55 64) scale(1.1) translate(-55 -64)" data-face="">
      <ellipse className="ab-skin-shade" cx="27.5" cy="66" rx="4" ry="6" />
      <ellipse className="ab-skin-shade" cx="82.5" cy="66" rx="4" ry="6" />
      <circle className="ab-stud" cx="27.2" cy="72.4" r="1.8" />
      <circle className="ab-stud" cx="82.8" cy="72.4" r="1.8" />
      <ellipse cx="55" cy="64" rx="27.5" ry="33" fill={`url(#${gid}f)`} />
      <ellipse className="ab-face-edge" cx="55" cy="64" rx="27.5" ry="33" />

      {/* features */}
      <ellipse className="ab-blush" cx="37" cy="78" rx="5.2" ry="3" />
      <ellipse className="ab-blush" cx="73" cy="78" rx="5.2" ry="3" />
      <path className="ab-nose" d="M52.6 73.4 Q55 76.6 57.4 73.4" />
      <Mouth kind={face.mouth} />
      <g className="ab-eyes" style={{ ["--ab-blink-o" as string]: blinkOffset } as CSSProperties}>
        <Eye cx={EYE_L} face={face} />
        <Eye cx={EYE_R} face={face} />
      </g>
      <path className="ab-brow" d={browL} />
      <path className="ab-brow" d={browR} />
      {rig.glasses ? <Glasses style={rig.glasses.style} /> : null}

      {/* hair in front: the scalloped hairline */}
      <g data-hair="front">
        {fringe.map((c, i) => (
          <circle key={i} className="ab-hair" cx={c.cx} cy={c.cy} r={c.r} />
        ))}
        <path className="ab-sheen" d="M42 38 A22 22 0 0 1 56 34.5" style={{ strokeWidth: 2, strokeOpacity: 0.4 }} />
      </g>
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------------ the body
/** One arm: shoulder cap, jacket sleeve, forearm sleeve with a cuff line, hand. Drawn pointing down, then rotated. */
function Arm({ side, spec, lift, anim, fore, dr }: { side: "L" | "R"; spec: ArmSpec; lift: number; anim?: string; fore?: string; dr?: number }) {
  const sx = SHOULDER[side][0];
  const sy = SHOULDER[side][1] + lift;
  const sol = solveArm([sx, sy], spec.target, spec.bend);
  const thumbX = side === "L" ? 7.4 : -7.4;
  const thumbRot = side === "L" ? -18 : 18;
  const style = dr !== undefined ? ({ ["--fb-dr" as string]: `${f(dr)}deg` } as CSSProperties) : undefined;
  return (
    <g transform={`translate(${sx} ${f(sy)})`} data-arm={side}>
      <g className={anim} style={style}>
        <g transform={`rotate(${sol.r1})`}>
          <circle className="ab-sleeve" cx="0" cy="0" r="9.8" />
          <rect className="ab-sleeve" x="-8.2" y="-3" width="16.4" height={L1 + 6} rx="8.2" />
          <g transform={`translate(0 ${L1})`}>
            <g className={fore}>
              <g transform={`rotate(${sol.r2})`}>
                <rect className="ab-sleeve" x="-7.8" y="-5" width="15.6" height="61" rx="7.8" />
                <circle className="ab-sleeve" cx="0" cy="0" r="7.8" style={{ stroke: "none" }} />
                <line className="ab-pipe-thin" x1="-7.8" y1="51" x2="7.8" y2="51" />
                <g transform={`rotate(${spec.handRot ?? 0} 0 57) translate(0 57) scale(1.2) translate(0 -57)`}>
                  <path className="ab-skin" d="M-6.2 57 H6.2 V68 Q6.2 80 0 81 Q-6.2 80 -6.2 68 Z" />
                  <ellipse className="ab-skin" cx={thumbX * 0.8} cy="65" rx="3" ry="7" transform={`rotate(${thumbRot} ${thumbX * 0.8} 65)`} />
                  {spec.open ? (
                    <g>
                      <line className="ab-fgap" x1="-2.9" y1="70" x2="-2.9" y2="80.5" />
                      <line className="ab-fgap" x1="0" y1="71" x2="0" y2="81" />
                      <line className="ab-fgap" x1="2.9" y1="70" x2="2.9" y2="80.5" />
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

/** One leg: a cropped wide-leg trouser, a bare ankle and a flat. Mirrored for the other side by the caller. */
function Leg() {
  return (
    <>
      <rect className="ab-skin" x="90" y="364" width="13" height="18" rx="5" />
      <path className="ab-shoe" d="M84 380 Q96 375 108 380 L113.5 387 Q114 391 108 391 L84 391 Q78 391 80 386 Z" />
      <path className="ab-trousers" d="M80 246 L120 246 L120 292 L117 368 Q99 371 81 368 Q79 300 80 246 Z" />
      <path className="ab-crease" d="M98 266 L97.5 362" />
    </>
  );
}

function ChartCard() {
  return (
    <g data-chart="">
      <rect className="ab-chart-card" x="178" y="82" width="57" height="46" rx="5" />
      {[
        [186, 10],
        [196, 16],
        [206, 13],
        [216, 24],
      ].map(([x, h]) => (
        <rect key={x} className="ab-chart-bar" x={x} y={120 - h} width="7" height={h} rx="1.4" />
      ))}
      <polyline className="ab-chart-line" points="189,104 200,97 211,100 225,89" />
    </g>
  );
}

export function AdvisorFullBody({
  pose: poseProp,
  mood,
  height = 240,
  label,
  decorative = false,
  announce = false,
  reducedMotion,
  className,
  chart = true,
  skin,
  suit,
  hairStyle,
  hairColour,
  glasses,
  frame,
  rig: rigProp,
}: AdvisorFullBodyProps): ReactNode {
  const pose = resolveAdvisorPose(poseProp, mood);
  const spec = ADVISOR_POSES[pose];
  const H = clampHeight(height);
  const W = Math.round(H * ASPECT);
  const uid = useId();
  const gid = "abg" + uid.replace(/[^A-Za-z0-9]/g, "");
  const blinkOffset = `-${(((hash32(uid) >>> 8) % 50) / 10).toFixed(1)}s`;

  const chosen = skin || suit || hairStyle || hairColour || glasses || frame;
  const base = rigProp ?? advisorDefault;
  const rig: CharacterRig = chosen
    ? (() => {
        const built = advisorRig({ skin, suit, hairStyle, hairColour, glasses, frame });
        // Start from the rig that was passed and take over only the parts the caller named.
        return {
          ...base,
          skin: skin ? built.skin : base.skin,
          skinShade: skin ? built.skinShade : base.skinShade,
          hair: { style: hairStyle ? built.hair.style : base.hair.style, colour: hairColour ? built.hair.colour : base.hair.colour },
          glasses: { style: glasses ? built.glasses!.style : (base.glasses?.style ?? "softRect"), colour: frame ? built.glasses!.colour : (base.glasses?.colour ?? built.glasses!.colour) },
          outfit: suit ? { ...base.outfit, jacket: built.outfit.jacket, jacketShade: built.outfit.jacketShade, lapel: built.outfit.lapel, piping: built.outfit.piping, trousers: built.outfit.trousers, trousersShade: built.outfit.trousersShade } : base.outfit,
        };
      })()
    : base;

  const name = label ?? rig.displayName;
  const word = ADVISOR_POSE_WORD[pose];
  const accessibleName = `${name}, ${word}: ${spec.describe}`;

  const headStyle: CSSProperties = {
    left: `${f(((HEAD.cx - HEAD.box / 2) / VB_W) * 100)}%`,
    top: `${f(((HEAD.cy - HEAD.box / 2) / VB_H) * 100)}%`,
    width: `${f((HEAD.box / VB_W) * 100)}%`,
    height: `${f((HEAD.box / VB_H) * 100)}%`,
    transformOrigin: "50% 106%",
    transform: `translateY(${f((spec.head.dy / HEAD.box) * 100)}%) rotate(${spec.head.tilt}deg)`,
  };

  // Celebrating: the arms rise from the rest angle; the keyframe needs the angle between the two.
  const rest = ADVISOR_POSES.idle;
  const restL = solveArm([SHOULDER.L[0], SHOULDER.L[1]], rest.L.target, rest.L.bend);
  const restR = solveArm([SHOULDER.R[0], SHOULDER.R[1]], rest.R.target, rest.R.bend);
  const upL = solveArm([SHOULDER.L[0], SHOULDER.L[1]], spec.L.target, spec.L.bend);
  const upR = solveArm([SHOULDER.R[0], SHOULDER.R[1]], spec.R.target, spec.R.bend);
  const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
  const drL = wrap(restL.r1 - upL.r1);
  const drR = wrap(restR.r1 - upR.r1);

  const armAnim = (side: "L" | "R"): { anim?: string; fore?: string; dr?: number } => {
    if (pose === "celebrating") return { anim: "ab-cheer", dr: side === "L" ? drL : drR };
    if (pose === "unsure") return { anim: "ab-shrug" };
    if (pose === "speaking" && side === "R") return { fore: "ab-gest" };
    if (pose === "presenting" && side === "R") return { fore: "ab-point" };
    return {};
  };

  const wrapperStyle: CSSProperties = { width: W, height: H, ...rigVars(rig) };
  const classes = ["advfb", reducedMotion ? "ab-static" : "", className ?? ""].filter(Boolean).join(" ");
  const breathes = pose !== "celebrating" && pose !== "unsure";
  const layerProps = { className: "ab-layer", viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: "xMidYMid meet", "aria-hidden": true, focusable: false } as const;

  return (
    <span className={classes} style={wrapperStyle} data-pose={pose} data-character="advisor" data-height={H}>
      <AdvisorFullBodyStyles />
      <span className="ab-stage" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": accessibleName })} data-advisor-fullbody="">
        {/* Back layer: pad, legs, neck, torso. */}
        <svg {...layerProps} data-layer="back">
          <defs>
            <linearGradient id={`${gid}j`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ab-stop-a" />
              <stop offset="1" className="ab-stop-b" />
            </linearGradient>
            <linearGradient id={`${gid}n`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ab-stop-s1" />
              <stop offset="0.7" className="ab-stop-s2" />
            </linearGradient>
          </defs>
          <ellipse className="ab-pad" cx="120" cy="391" rx="62" ry="7" />
          <ellipse className="ab-padring" cx="120" cy="391" rx="62" ry="7" />
          <g data-leg="L">
            <Leg />
          </g>
          <g data-leg="R" transform={`translate(${VB_W} 0) scale(-1 1)`}>
            <Leg />
          </g>
          <g transform="translate(120 258)">
            <g className={breathes ? "ab-breathe" : undefined}>
              <g transform="translate(-120 -258)">
                <path fill={`url(#${gid}n)`} d="M108 96 H132 L134 128 H106 Z" />
                <path className="ab-jacket" fill={`url(#${gid}j)`} d="M110 123 Q96 126 84 131 Q73 135 73 148 L78 188 Q87 208 85 226 Q81 246 76 262 Q98 266 120 266 Q142 266 164 262 Q159 246 155 226 Q153 208 162 188 L167 148 Q167 135 156 131 Q144 126 130 123 Z" />
                <path className="ab-blouse" d="M104 124 L136 124 L120 196 Z" />
                <path className="ab-skin" d="M105.5 123.5 L134.5 123.5 Q133 140 120 150 Q107 140 105.5 123.5 Z" />
                <path className="ab-chain" d="M110 124 Q120 142 130 124" />
                <circle className="ab-pendant" cx="120" cy="137.6" r="1.8" />
                <path className="ab-lapel" d="M104 124 L120 196 L111 204 L88 152 L95 137 Z" />
                <path className="ab-lapel" d="M136 124 L120 196 L129 204 L152 152 L145 137 Z" />
                <path className="ab-seam" d="M100 168 Q98 190 103 210" />
                <path className="ab-seam" d="M140 168 Q142 190 137 210" />
                <path className="ab-pipe-thin" d="M88 240 L106 236.5" />
                <path className="ab-pipe-thin" d="M152 240 L134 236.5" />
                <circle className="ab-button" cx="120" cy="206" r="2.6" />
                <path className="ab-pipe" d="M77 261 Q120 267 163 261" />
              </g>
            </g>
          </g>
        </svg>

        {/* Head slot: afro, face and glasses, tilted about the neck. */}
        <span className="ab-head" style={headStyle} data-layer="head">
          <span className={`ab-head-in${breathes ? " ab-bob" : ""}`}>
            <Head gid={gid} rig={rig} pose={pose} blinkOffset={blinkOffset} />
          </span>
        </span>

        {/* Front layer: arms (a hand can sit in front of the face) and the chart she points at. */}
        <svg {...layerProps} data-layer="front">
          <g transform="translate(120 258)">
            <g className={breathes ? "ab-breathe" : undefined}>
              <g transform="translate(-120 -258)">
                <Arm side="L" spec={spec.L} lift={spec.lift} {...armAnim("L")} />
                <Arm side="R" spec={spec.R} lift={spec.lift} {...armAnim("R")} />
              </g>
            </g>
          </g>
          {pose === "presenting" && chart ? <ChartCard /> : null}
        </svg>
      </span>
      {announce ? (
        <span className="ab-sr" role="status" aria-live="polite">
          {`${name} is ${word}`}
        </span>
      ) : null}
    </span>
  );
}

export default AdvisorFullBody;
