import { useId, type CSSProperties, type ReactNode } from "react";
import { FayeAvatar, FAYE_MOODS, FULL_DETAIL_MIN, MOOD_WORD, hash32, type FayeMood } from "./FayeAvatar";
import { FayeAvatarStyles } from "./FayeAvatarStyles";

/**
 * AgentMark: the small identity mark for each assistant, one set of rules for both.
 *
 *   kind="faye"    renders FayeAvatar (the teal aperture face).
 *   kind="claude"  renders the lead assistant's mark: an ORIGINAL amber diamond (a rounded square turned 45 degrees)
 *                  with a centre dot and one outer tick that orbits while the assistant is working. It is a
 *                  geometric mark made for this app. It is not Anthropic's logo and does not use its colours; amber
 *                  is just this app's "verdict" token. Whether official branding may be used here is a separate
 *                  brand-guideline question nobody has answered.
 *
 * Teal means Faye, amber means Claude, so the pair reads at a glance, and the shapes differ (circle versus diamond)
 * so nothing depends on colour alone.
 *
 * ## Props (shared by both kinds)
 *
 *   kind         "faye" | "claude"                      (default "faye")
 *   mood         FayeMood, default "idle". For "claude": idle, thinking, speaking, unsure, offline and error have
 *                their own look. listening and celebrating are drawn as idle (the diamond has no face), but the
 *                accessible name still says what was passed.
 *   size         pixels, default 48. Detail (inner diamond, bezel ticks) turns on at 56 px and above.
 *   label        name in the accessible name; defaults to "Faye" or "Claude". The name is "<label>, <mood>".
 *   decorative   aria-hidden, no role, when text beside it already names the speaker.
 *   announce     visually hidden aria-live="polite" status, updated on mood change only.
 *   chunkTick    speaking: a counter that increases per streamed chunk (one pulse per change).
 *   reducedMotion  force the static variant; otherwise follows prefers-reduced-motion.
 *   className    extra class on the wrapper.
 *
 * ## Two-up example: "Faye and Claude side by side"
 *
 *   <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
 *     <AgentMark kind="faye" mood="thinking" size={32} />
 *     <AgentMark kind="claude" mood="idle" size={32} />
 *   </div>
 *
 * or the ready-made pair:
 *
 *   <AgentPair faye="speaking" claude="idle" size={32} fayeChunkTick={n} />
 *
 * Both fill a fixed square, so switching moods never moves the layout.
 */
export interface AgentMarkProps {
  kind?: "faye" | "claude";
  mood?: FayeMood;
  size?: number;
  label?: string;
  decorative?: boolean;
  announce?: boolean;
  chunkTick?: number;
  reducedMotion?: boolean;
  className?: string;
}

// Dash patterns on a path of length 100 for the diamond outline.
const DIAMOND_DASH: Partial<Record<FayeMood, string>> = {
  unsure: "55 6 28 11",
  offline: "2.2 2.8",
  error: "2.2 2.8",
};

function ClaudeMark({ mood = "idle", size = 48, label = "Claude", decorative = false, announce = false, chunkTick, reducedMotion, className }: Omit<AgentMarkProps, "kind">): ReactNode {
  const safeMood: FayeMood = FAYE_MOODS.includes(mood) ? mood : "idle";
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 48;
  const full = px >= FULL_DETAIL_MIN;
  const uid = useId();
  const h = hash32(uid);
  const dim = safeMood === "offline" || safeMood === "error";
  const word = MOOD_WORD[safeMood];
  const dash = DIAMOND_DASH[safeMood];
  const working = safeMood === "thinking" || safeMood === "speaking";
  const speakingClock = safeMood === "speaking" && chunkTick !== undefined;
  const style = { width: px, height: px, ["--fa-blink-o" as string]: `-${(((h >>> 8) % 50) / 10).toFixed(1)}s` } as CSSProperties;
  const classes = ["agentmark", reducedMotion ? "fa-static" : "", className ?? ""].filter(Boolean).join(" ");
  // Unsure and offline swap the solid dot for a hollow ring, so the state is shape as well as colour.
  const hollow = safeMood === "unsure" || dim;

  return (
    <span className={classes} style={style} data-kind="claude" data-mood={safeMood} data-detail={full ? "full" : "min"} data-size={px}>
      <FayeAvatarStyles />
      <svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": `${label}, ${word}` })}
        data-agent-mark="claude"
      >
        {full ? (
          <g opacity={dim ? 0.45 : 1}>
            {[0, 90, 180, 270].map((deg) => (
              <line key={deg} className="fa-bezel" x1="32" y1="2.2" x2="32" y2="4" transform={`rotate(${deg} 32 32)`} />
            ))}
          </g>
        ) : null}

        <g key={speakingClock ? `pulse-${chunkTick}` : "mark"} className={speakingClock ? "fa-pulse" : undefined}>
          <rect className="fa-disc" x="14" y="14" width="36" height="36" rx="7" transform="rotate(45 32 32)" />
          <rect
            className={`fa-ring${dash ? " fa-butt" : ""}`}
            x="14"
            y="14"
            width="36"
            height="36"
            rx="7"
            pathLength={100}
            strokeDasharray={dash}
            transform="rotate(45 32 32)"
            opacity={dim ? 0.75 : undefined}
          />
          {full && !dim ? <rect className="fa-thin" x="21" y="21" width="22" height="22" rx="4" transform="rotate(45 32 32)" style={{ opacity: 0.35 }} /> : null}

          {hollow ? (
            <circle className="fa-hollow" cx="32" cy="32" r={full ? 4.4 : 4.2} />
          ) : (
            <circle className={`fa-dot${safeMood === "idle" || safeMood === "listening" || safeMood === "celebrating" ? " fa-breathe" : ""}${safeMood === "thinking" ? " fa-heart" : ""}${speakingClock ? " fa-heart-once" : ""}${safeMood === "speaking" && !speakingClock ? " fa-heart" : ""}`} cx="32" cy="32" r="4" />
          )}
        </g>

        {/* The outer tick orbits while working; parked at the upper right otherwise, dropped when unsure or offline. */}
        {!dim && safeMood !== "unsure" ? (
          <g transform="rotate(45 32 32)">
            <line className={`fa-tick${working ? " fa-orbit" : ""}`} x1="32" y1="2.6" x2="32" y2="6.4" />
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

export function AgentMark({ kind = "faye", ...rest }: AgentMarkProps): ReactNode {
  if (kind === "claude") return <ClaudeMark {...rest} />;
  return <FayeAvatar {...rest} />;
}

/** "Faye and Claude side by side": the two marks in a row with a small gap. */
export function AgentPair({
  faye = "idle",
  claude = "idle",
  size = 32,
  fayeChunkTick,
  claudeChunkTick,
  gap = 12,
  reducedMotion,
}: {
  faye?: FayeMood;
  claude?: FayeMood;
  size?: number;
  fayeChunkTick?: number;
  claudeChunkTick?: number;
  gap?: number;
  reducedMotion?: boolean;
}): ReactNode {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap }} data-agent-pair="">
      <AgentMark kind="faye" mood={faye} size={size} chunkTick={fayeChunkTick} reducedMotion={reducedMotion} />
      <AgentMark kind="claude" mood={claude} size={size} chunkTick={claudeChunkTick} reducedMotion={reducedMotion} />
    </span>
  );
}

export default AgentMark;
