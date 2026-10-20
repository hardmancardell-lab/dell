import { useId, type CSSProperties, type ReactNode } from "react";
import { FayeAvatarStyles } from "./FayeAvatarStyles";

/**
 * FayeAvatar: Faye's face. The "aperture face": a teal ring (the head), two capsule eyes, and a sparkline mouth.
 * Inline SVG plus CSS only, Jarvis tokens only, no images, no dependencies, no timers, no state.
 *
 * ## Props
 *
 *   mood         "idle" | "listening" | "thinking" | "speaking" | "unsure" | "celebrating" | "offline" | "error"
 *                Default "idle". "error" is the failed-job flavour of the offline state (same dim face plus a
 *                small danger marker); the design's seven states are idle, listening, thinking, speaking, unsure,
 *                celebrating and offline/error.
 *   size         Pixels, default 48. Square. Detail turns on at 56 px and above (bezel ticks, brows, glow, burst
 *                ticks); below that the face is ring + two eyes + a short mouth so it stays crisp at 32 px.
 *   label        The name used in the accessible name. Default "Faye". The name is "<label>, <mood>".
 *   decorative   true when the avatar sits next to a text label that already says the same thing: renders aria-hidden
 *                and no role. Default false.
 *   announce     true to add a visually hidden aria-live="polite" status ("Faye is thinking"). It re-renders only
 *                when the mood changes, never per chunk. Use on ONE avatar per screen. Default false.
 *   chunkTick    Speaking only. Pass a number that increases on every streamed chunk (for example a counter you
 *                bump in the onChunk handler). Each change plays one mouth jump and one ring pulse, so the mouth
 *                follows the real chunk timing and not audio. If it is omitted while speaking, a gentle looping
 *                mouth is shown instead.
 *   reducedMotion  true to force the static variant (no animation) regardless of the OS setting. Leave undefined to
 *                follow `prefers-reduced-motion` automatically. In the static variant meaning is carried by shape
 *                alone: unsure is amber AND a tilde mouth AND a tilted head AND one lowered lid.
 *   className    Extra class on the wrapper.
 *
 * ## Usage
 *
 *   <FayeAvatar mood={busy ? "thinking" : "idle"} size={32} decorative />   // chat bubble speaker icon
 *   <FayeAvatar mood="speaking" size={160} chunkTick={chunkCount} announce /> // lab header
 *
 * The wrapper has a fixed width and height, and every state lives in the same 64 x 64 viewBox, so changing the mood
 * never shifts the layout. Safe to render on the server; there is no client-only code in here.
 */
export type FayeMood = "idle" | "listening" | "thinking" | "speaking" | "unsure" | "celebrating" | "offline" | "error";

export const FAYE_MOODS: readonly FayeMood[] = ["idle", "listening", "thinking", "speaking", "unsure", "celebrating", "offline", "error"];

export interface FayeAvatarProps {
  mood?: FayeMood;
  size?: number;
  label?: string;
  decorative?: boolean;
  announce?: boolean;
  chunkTick?: number;
  reducedMotion?: boolean;
  className?: string;
}

/** The word used in the accessible name and the live region. */
export const MOOD_WORD: Record<FayeMood, string> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  unsure: "unsure",
  celebrating: "celebrating",
  offline: "offline",
  error: "error",
};

/** Detail (bezel ticks, brows, glow, burst ticks) turns on at this size. */
export const FULL_DETAIL_MIN = 56;

/** FNV-1a, to turn a React id into a stable blink rhythm that differs between avatars. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [32 + r * Math.cos(a), 32 + r * Math.sin(a)];
}
const f = (n: number) => Math.round(n * 100) / 100;

const BEZEL = Array.from({ length: 12 }, (_, i) => {
  const [x1, y1] = polar(29.6, i * 30);
  const [x2, y2] = polar(31.2, i * 30);
  return { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2) };
});

const BURST = Array.from({ length: 6 }, (_, i) => {
  const [x1, y1] = polar(29.2, i * 60 - 90);
  const [x2, y2] = polar(31.7, i * 60 - 90);
  return { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2) };
});

// Mouth shapes: a short polyline each (a sparkline), so the mouth can double as the speaking indicator.
const MOUTH = {
  flat: "22,44 32,44 42,44",
  short: "25,44 39,44",
  thinking: "25,43.5 39,43.5",
  speaking: "20,44 25,42 30,45.5 35,42.5 40,45 44,43.5",
  tilde: "21,45 26.5,41.5 32,45 37.5,48.5 43,45",
  smile: "21,41.5 25.5,46 32,48 38.5,46 43,41.5",
} as const;

// Ring dash patterns on a path of length 100 (pathLength), so they do not depend on the radius.
const RING_DASH: Partial<Record<FayeMood, string>> = {
  thinking: "84 16",
  unsure: "55 6 28 11",
  offline: "2.2 2.8",
  error: "2.2 2.8",
};

function Eyes({ mood }: { mood: FayeMood }) {
  switch (mood) {
    case "celebrating":
      return (
        <>
          <path className="fa-line" d="M19.8 31 Q23.5 24.5 27.2 31" />
          <path className="fa-line" d="M36.8 31 Q40.5 24.5 44.2 31" />
        </>
      );
    case "offline":
    case "error":
      return (
        <>
          <line className="fa-line" x1="20.5" y1="30" x2="26.5" y2="30" />
          <line className="fa-line" x1="37.5" y1="30" x2="43.5" y2="30" />
        </>
      );
    case "listening":
      return (
        <g className="fa-blink">
          <rect className="fa-eye" x="19.8" y="23" width="7" height="12.2" rx="3.5" />
          <rect className="fa-eye" x="37.2" y="23" width="7" height="12.2" rx="3.5" />
        </g>
      );
    case "thinking":
      // Looking up and to the right: the whole pair is offset.
      return (
        <g transform="translate(2.2 -2.6)">
          <rect className="fa-eye" x="20.3" y="24" width="6.4" height="10" rx="3.2" />
          <rect className="fa-eye" x="37.3" y="24" width="6.4" height="10" rx="3.2" />
        </g>
      );
    case "unsure":
      // One lid lowered: the right eye is narrowed and a lid line sits over it.
      return (
        <>
          <rect className="fa-eye" x="20.3" y="24" width="6.4" height="10" rx="3.2" />
          <rect className="fa-eye" x="37.3" y="29" width="6.4" height="5.4" rx="2.4" />
          <line className="fa-line" x1="36.8" y1="27.6" x2="44.2" y2="26.8" style={{ strokeWidth: 2.2 }} />
        </>
      );
    default:
      return (
        <g className={mood === "idle" ? "fa-blink" : undefined}>
          <rect className="fa-eye" x="20.3" y="24" width="6.4" height="10" rx="3.2" />
          <rect className="fa-eye" x="37.3" y="24" width="6.4" height="10" rx="3.2" />
        </g>
      );
  }
}

function Brows({ mood }: { mood: FayeMood }) {
  // Serious-warm: nearly level brows (a steep inner tilt reads as worry). Only drawn at full detail.
  const b = (dy: number, dyL = dy, dyR = dy, slope = 0.5) => (
    <>
      <line className="fa-thin" x1="19.5" y1={f(20.8 + dyL)} x2="27" y2={f(20.8 + dyL - slope)} />
      <line className="fa-thin" x1="37" y1={f(20.8 + dyR - slope)} x2="44.5" y2={f(20.8 + dyR)} />
    </>
  );
  switch (mood) {
    case "listening":
      return b(-1.6);
    case "thinking":
      return <g transform="translate(2.2 -2.6)">{b(0, 0.8, -1.2)}</g>;
    case "unsure":
      return b(0, -2.6, 1.6, 1.4);
    case "celebrating":
      return b(-2.2);
    case "offline":
    case "error":
      return null;
    default:
      return b(0);
  }
}

function Mouth({ mood, chunkTick }: { mood: FayeMood; chunkTick?: number }) {
  if (mood === "speaking") {
    // Looping fallback only when the caller gives no chunk clock; with a clock each change replays one jump.
    const cls = chunkTick === undefined ? "fa-talk" : "fa-jump";
    return (
      <g key={chunkTick === undefined ? "loop" : `chunk-${chunkTick}`} className={cls}>
        <polyline className="fa-line" points={MOUTH.speaking} />
      </g>
    );
  }
  const points = mood === "thinking" ? MOUTH.thinking : mood === "unsure" ? MOUTH.tilde : mood === "celebrating" ? MOUTH.smile : mood === "offline" || mood === "error" ? MOUTH.short : MOUTH.flat;
  return <polyline className="fa-line" points={points} />;
}

export function FayeAvatar({
  mood = "idle",
  size = 48,
  label = "Faye",
  decorative = false,
  announce = false,
  chunkTick,
  reducedMotion,
  className,
}: FayeAvatarProps): ReactNode {
  const safeMood: FayeMood = FAYE_MOODS.includes(mood) ? mood : "idle";
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 48;
  const full = px >= FULL_DETAIL_MIN;
  const uid = useId();
  const gid = "fag" + uid.replace(/[^A-Za-z0-9]/g, "");
  const h = hash32(uid);
  const wrapStyle = {
    width: px,
    height: px,
    ["--fa-blink-d" as string]: `${(5 + (h % 21) / 10).toFixed(1)}s`,
    ["--fa-blink-o" as string]: `-${(((h >>> 8) % 50) / 10).toFixed(1)}s`,
  } as CSSProperties;

  const word = MOOD_WORD[safeMood];
  const accessibleName = `${label}, ${word}`;
  const dim = safeMood === "offline" || safeMood === "error";
  const dash = RING_DASH[safeMood];
  const ringR = safeMood === "listening" ? 25 : 26;
  // Thinking: the gap rotates. Static variant parks the gap at the upper right.
  const ringClass = dash ? "fa-ring fa-butt" : "fa-ring";

  const classes = ["fayeav", reducedMotion ? "fa-static" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <span className={classes} style={wrapStyle} data-mood={safeMood} data-detail={full ? "full" : "min"} data-size={px}>
      <FayeAvatarStyles />
      <svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": accessibleName })}
        data-faye-avatar=""
      >
        {full ? (
          <defs>
            <radialGradient id={gid} cx="50%" cy="50%" r="50%">
              <stop offset="0%" className="fa-glow-stop" stopOpacity={dim ? 0 : 0.2} />
              <stop offset="100%" className="fa-glow-stop" stopOpacity={0} />
            </radialGradient>
          </defs>
        ) : null}

        {full ? (
          <g className="fa-bezel-ring" opacity={dim ? 0.45 : 1}>
            {BEZEL.map((t, i) => (
              <line key={i} className="fa-bezel" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
            ))}
          </g>
        ) : null}

        {safeMood === "listening" ? (
          <g transform="rotate(-90 32 32)">
            <circle className="fa-ring fa-orbit" cx="32" cy="32" r="29.8" pathLength={100} strokeDasharray="9 91" style={{ strokeWidth: full ? 1.8 : 2.4 }} />
          </g>
        ) : null}

        <g transform={safeMood === "unsure" ? "rotate(6 32 32)" : undefined}>
          <g
            key={safeMood === "speaking" && chunkTick !== undefined ? `pulse-${chunkTick}` : "head"}
            className={safeMood === "speaking" && chunkTick !== undefined ? "fa-pulse" : safeMood === "unsure" ? "fa-nod" : safeMood === "celebrating" ? "fa-hop" : undefined}
          >
            <circle className="fa-disc" cx="32" cy="32" r={ringR} />
            {full && !dim ? <circle className={safeMood === "idle" ? "fa-breathe" : undefined} cx="32" cy="32" r="25" fill={`url(#${gid})`} /> : null}

            <g transform="rotate(-90 32 32)">
              <circle
                className={`${ringClass}${safeMood === "thinking" ? " fa-gap" : ""}${safeMood === "idle" && full ? " fa-breathe" : ""}`}
                cx="32"
                cy="32"
                r={ringR}
                pathLength={100}
                strokeDasharray={dash}
                transform={safeMood === "thinking" ? "rotate(40)" : undefined}
                opacity={dim ? 0.75 : undefined}
              />
            </g>

            {full ? <Brows mood={safeMood} /> : null}
            <Eyes mood={safeMood} />
            <Mouth mood={safeMood} chunkTick={chunkTick} />

            {safeMood === "thinking" ? (
              <g className="fa-dots">
                <circle className="fa-dot" cx="26" cy="50.5" r={full ? 1.7 : 2} />
                <circle className="fa-dot" cx="32" cy="50.5" r={full ? 1.7 : 2} />
                <circle className="fa-dot" cx="38" cy="50.5" r={full ? 1.7 : 2} />
              </g>
            ) : null}
          </g>
        </g>

        {safeMood === "celebrating" && full ? (
          <g className="fa-burst">
            {BURST.map((t, i) => (
              <line key={i} className="fa-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
            ))}
          </g>
        ) : null}

        {safeMood === "error" ? (
          <g data-error-marker="">
            <circle className="fa-danger-fill" cx="50" cy="50" r="8" />
            <line className="fa-danger" x1="50" y1="46" x2="50" y2="50.6" />
            <circle cx="50" cy="54" r="1.4" style={{ fill: "var(--fa-danger)" }} />
          </g>
        ) : null}
      </svg>
      {announce ? (
        <span className="fa-sr" role="status" aria-live="polite">
          {`${label} is ${word}`}
        </span>
      ) : null}
    </span>
  );
}

export default FayeAvatar;
