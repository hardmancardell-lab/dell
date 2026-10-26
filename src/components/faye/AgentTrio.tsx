import type { CSSProperties, ReactNode } from "react";
import { FayeFullBody } from "./FayeFullBody";
import { AdvisorFullBody, type AdvisorFullBodyProps } from "./AdvisorFullBody";
import { AgentMark } from "./AgentMark";
import { ASPECT, tokenRef, type AdvisorPose } from "./CharacterRig";
import type { FayeMood } from "./FayeAvatar";

/**
 * AgentTrio: the documented way to show all three together, Faye, the advisor and Claude, side by side on one floor line.
 *
 *   <AgentTrio height={240} advisor="presenting" />
 *   <AgentTrio height={320} faye="thinking" advisor="speaking" claude="thinking" />
 *   <AgentTrio height={240} advisorLook={{ suit: "teal", skin: "deep" }} />
 *
 * Faye and the advisor are full-body characters (the same 0.6 aspect, the same height, so their feet share a floor line).
 * Claude has no body: its mark (the amber diamond, see AgentMark) floats at head height in a cell of the same size, with a
 * floor ring under it so the three read as one row. Teal means Faye, amber means Claude, and the advisor wears the
 * owner's colour (plum by default), so no two of them share a hue.
 *
 *   height         Pixels tall for the figures, clamped 120..480 (default 240).
 *   faye           Faye's mood (default "idle").       advisor  The advisor's pose (default "idle").
 *   claude         Claude's mood (default "idle").
 *   advisorLook    The owner's choices for the advisor (skin, suit, hairStyle, hairColour, glasses, frame, rig).
 *   captions       Small name under each (default true). The captions are text, so they are real labels.
 *   gap            Pixels between the three (default 12% of the height).
 *   reducedMotion  Force static poses for all three.
 *   className      Extra class on the wrapper.
 *
 * The wrapper is role="group" named "Faye, the advisor and Claude"; each figure inside keeps its own accessible name.
 */
export interface AgentTrioProps {
  height?: number;
  faye?: FayeMood;
  advisor?: AdvisorPose;
  claude?: FayeMood;
  advisorLook?: Pick<AdvisorFullBodyProps, "skin" | "suit" | "hairStyle" | "hairColour" | "glasses" | "frame" | "rig" | "chart">;
  captions?: boolean;
  gap?: number;
  reducedMotion?: boolean;
  className?: string;
}

const clamp = (h: unknown) => Math.round(Math.min(480, Math.max(120, typeof h === "number" && Number.isFinite(h) ? h : 240)));

export function AgentTrio({ height = 240, faye = "idle", advisor = "idle", claude = "idle", advisorLook, captions = true, gap, reducedMotion, className }: AgentTrioProps): ReactNode {
  const H = clamp(height);
  const W = Math.round(H * ASPECT);
  const g = gap === undefined ? Math.round(H * 0.12) : Math.max(0, Math.round(gap));
  const mark = Math.round(H * 0.4);
  const cell: CSSProperties = { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 };
  const cap: CSSProperties = { font: "500 12px/1.2 var(--font-ui, system-ui, sans-serif)", color: tokenRef("text1"), letterSpacing: "0.02em" };
  const claudeCell: CSSProperties = { position: "relative", width: W, height: H, display: "block" };
  return (
    <span
      role="group"
      aria-label="Faye, the advisor and Claude"
      className={["agent-trio", className ?? ""].filter(Boolean).join(" ")}
      style={{ display: "inline-flex", alignItems: "flex-end", gap: g }}
      data-agent-trio=""
      data-height={H}
    >
      <span style={cell} data-trio="faye">
        <FayeFullBody mood={faye} height={H} reducedMotion={reducedMotion} />
        {captions ? <span style={cap}>Faye</span> : null}
      </span>
      <span style={cell} data-trio="advisor">
        <AdvisorFullBody pose={advisor} height={H} reducedMotion={reducedMotion} {...advisorLook} />
        {captions ? <span style={cap}>Advisor</span> : null}
      </span>
      <span style={cell} data-trio="claude">
        <span style={claudeCell}>
          <span style={{ position: "absolute", left: "50%", top: Math.round(H * 0.14), transform: "translateX(-50%)", display: "block", lineHeight: 0 }}>
            <AgentMark kind="claude" mood={claude} size={mark} reducedMotion={reducedMotion} />
          </span>
          <svg viewBox="0 0 240 400" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <ellipse cx="120" cy="391" rx="62" ry="7" style={{ fill: tokenRef("verdict"), fillOpacity: 0.08 }} />
            <ellipse cx="120" cy="391" rx="62" ry="7" style={{ fill: "none", stroke: tokenRef("verdict"), strokeWidth: 1.2, strokeOpacity: 0.4 }} />
          </svg>
        </span>
        {captions ? <span style={cap}>Claude</span> : null}
      </span>
    </span>
  );
}

export default AgentTrio;
