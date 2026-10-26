import type { CSSProperties } from "react";
import { CHARACTER, JARVIS } from "@/lib/design/tokens";
import type { FayeMood } from "./FayeAvatar";

/**
 * CharacterRig: the shared base for every full-body character (Faye now, the advisor next).
 *
 * A rig is plain data: which Jarvis TOKEN NAME each part of the figure uses. It never holds a colour value, so the
 * design-token ratchet stays happy and a theme change reaches the body for free. `rigVars()` turns a rig into CSS custom
 * properties (`--fb-jacket: var(--ink-700, <fallback>)`), which FayeFullBody's stylesheet reads.
 *
 * ## The advisor (built 2026-10-21: AdvisorFullBody.tsx, advisorDefault below)
 * The notes that follow were the plan; the advisor now exists as a human head (afro, glasses, a real face), a pantsuit and
 * the ADVISOR_POSES table, and the owner's choices are props (skin, suit, hairStyle, hairColour, glasses, frame).
 *
 * ## How the advisor was planned (original notes)
 * The owner would choose, in about five minutes:
 *   1. Skin tone. Only tokens may be used today, so Faye's "ink-glass" blue-grey is the one available tone. A human
 *      skin range (say 6 tones) needs a small palette added to src/lib/design/tokens.ts AND globals.css, which is an
 *      owner decision because the token ratchet guards that file.
 *   2. Hair: none, short, bob, long, or covered (hijab, cap). The rig has a `hair` slot; only "none" is drawn so far,
 *      because Faye's head is the aperture face. A human advisor needs a different head, see 5.
 *   3. Outfit: jacket (or cardigan, or shirt only), piping colour (teal, amber or none), trousers or skirt length.
 *      Amber piping would keep the "amber means the lead assistant, teal means Faye" colour code.
 *   4. Build: shoulder width and height (a small `build` option to add), so the two characters do not share a silhouette.
 *   5. Head: reuse the aperture face in amber (like AgentMark's diamond), or a simple flat-vector human head. The
 *      FayeFullBody `head` layer is one absolutely positioned slot, so swapping it does not touch the body or poses.
 * Poses (POSES below), the arm solver and the stylesheet are shared, so a new character gets all seven poses at once.
 */

/** A Jarvis token (ink, line, signal...) or a CHARACTER token (skin, hair, suit colours; see tokens.ts). */
export type TokenName = keyof typeof JARVIS | keyof typeof CHARACTER;

/** "none": Faye (the aperture face is the head). "afro": full and round. "afroTapered": a smaller, closer natural crop. */
export type HairStyle = "none" | "afro" | "afroTapered";

/** Glasses for a human head (the advisor). "none" draws no frames. */
export type GlassesStyle = "none" | "round" | "softRect";

export interface CharacterRig {
  id: string;
  /** Used as the default accessible name. */
  displayName: string;
  skin: TokenName;
  skinShade: TokenName;
  hair: { style: HairStyle; colour: TokenName };
  /** Human heads only (additive; FAYE_RIG leaves these out and its output is unchanged). */
  glasses?: { style: GlassesStyle; colour: TokenName };
  face?: { lips: TokenName; eyeWhite: TokenName; iris: TokenName };
  outfit: {
    jacket: TokenName;
    jacketShade: TokenName;
    lapel: TokenName;
    piping: TokenName;
    shirt: TokenName;
    trousers: TokenName;
    trousersShade: TokenName;
    shoes: TokenName;
    outline: TokenName;
  };
}

/** Faye: dark ink-blue structured jacket, teal piping, luminous blue-grey "ink-glass" skin, aperture face for a head. */
export const FAYE_RIG: CharacterRig = {
  id: "faye",
  displayName: "Faye",
  skin: "text1",
  skinShade: "text2",
  hair: { style: "none", colour: "ink950" },
  outfit: {
    jacket: "ink700",
    jacketShade: "ink800",
    lapel: "ink800",
    piping: "signal",
    shirt: "ink950",
    trousers: "ink800",
    trousersShade: "ink900",
    shoes: "ink950",
    outline: "lineBright",
  },
};

/** camelCase token name to the CSS custom property in globals.css (ink900 to --ink-900, lineBright to --line-bright, skinMediumDeep to --skin-medium-deep). */
export function tokenVarName(name: TokenName): string {
  return "--" + String(name).replace(/([A-Z])/g, (m) => "-" + m.toLowerCase()).replace(/([a-z])(\d)/, "$1-$2");
}

/** `var(--ink-700, <tokens.ts value>)`: the live token with the tokens.ts value as fallback outside a .jarvis island. */
export function tokenRef(name: TokenName): string {
  const value = (JARVIS as Record<string, string>)[name] ?? (CHARACTER as Record<string, string>)[name];
  return `var(${tokenVarName(name)},${value})`;
}

export function rigVars(rig: CharacterRig): CSSProperties {
  const o = rig.outfit;
  const v: Record<string, string> = {
    "--fb-skin": tokenRef(rig.skin),
    "--fb-skin-shade": tokenRef(rig.skinShade),
    "--fb-hair": tokenRef(rig.hair.colour),
    "--fb-jacket": tokenRef(o.jacket),
    "--fb-jacket-shade": tokenRef(o.jacketShade),
    "--fb-lapel": tokenRef(o.lapel),
    "--fb-piping": tokenRef(o.piping),
    "--fb-shirt": tokenRef(o.shirt),
    "--fb-trousers": tokenRef(o.trousers),
    "--fb-trousers-shade": tokenRef(o.trousersShade),
    "--fb-shoes": tokenRef(o.shoes),
    "--fb-outline": tokenRef(o.outline),
    "--fb-signal": tokenRef("signal"),
    "--fb-verdict": tokenRef("verdict"),
    "--fb-dim": tokenRef("text2"),
    "--fb-danger": tokenRef("danger"),
    "--fb-ink": tokenRef("ink900"),
  };
  // Additive: only rigs that define these (the advisor) get the extra properties, so Faye's markup is untouched.
  if (rig.glasses) v["--fb-glasses"] = tokenRef(rig.glasses.colour);
  if (rig.face) {
    v["--fb-lips"] = tokenRef(rig.face.lips);
    v["--fb-eye-white"] = tokenRef(rig.face.eyeWhite);
    v["--fb-iris"] = tokenRef(rig.face.iris);
  }
  return v as CSSProperties;
}

// ------------------------------------------------------------------------------------------------------ geometry
export const VB_W = 240;
export const VB_H = 400;
export const ASPECT = VB_W / VB_H;
export const HEAD = { cx: 120, cy: 58, box: 110 } as const;

/** Arm segment lengths in viewBox units: shoulder to elbow, and elbow to the centre of the hand. */
export const L1 = 60;
export const L2 = 70;

export const SHOULDER = { L: [82, 136], R: [158, 136] } as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const deg = (rad: number) => (rad * 180) / Math.PI;

export interface ArmSolution {
  /** Rotation (degrees, SVG sense) of the upper arm about the shoulder, arm drawn pointing down at 0. */
  r1: number;
  /** Rotation of the forearm about the elbow, relative to the upper arm. */
  r2: number;
  elbow: [number, number];
  hand: [number, number];
}

/**
 * Two-link solver: put the hand centre on `target` (clamped to what the arm can reach). `bend` picks which of the two
 * elbow positions is used (+1 clockwise on screen, -1 anticlockwise). Pure and deterministic; rounded to 2 decimals.
 */
export function solveArm(shoulder: readonly [number, number], target: readonly [number, number], bend: 1 | -1): ArmSolution {
  const dx = target[0] - shoulder[0];
  const dy = target[1] - shoulder[1];
  const d = Math.hypot(dx, dy) || 0.0001;
  const dd = Math.min(Math.max(d, Math.abs(L1 - L2) + 1), L1 + L2 - 0.5);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd))));
  const base = Math.atan2(dy, dx);
  const ea = base + bend * alpha;
  const ex = shoulder[0] + L1 * Math.cos(ea);
  const ey = shoulder[1] + L1 * Math.sin(ea);
  const hx = shoulder[0] + (dx / d) * dd;
  const hy = shoulder[1] + (dy / d) * dd;
  const a1 = deg(Math.atan2(-(ex - shoulder[0]), ey - shoulder[1]));
  const a2 = deg(Math.atan2(-(hx - ex), hy - ey));
  let rel = a2 - a1;
  while (rel > 180) rel -= 360;
  while (rel < -180) rel += 360;
  return { r1: r2(a1), r2: r2(rel), elbow: [r2(ex), r2(ey)], hand: [r2(hx), r2(hy)] };
}

export interface ArmSpec {
  target: readonly [number, number];
  bend: 1 | -1;
  /** Extra hand rotation (degrees) about the wrist. */
  handRot?: number;
  /** Open palm (finger gaps drawn) or relaxed. */
  open?: boolean;
}

export interface PoseSpec {
  /** Short plain-language description, used in the accessible name. */
  describe: string;
  L: ArmSpec;
  R: ArmSpec;
  /** Shoulder lift in viewBox units (negative is up): the shrug. */
  lift: number;
  /** Whole upper body drop in viewBox units (the seated pose). */
  sit: number;
  head: { tilt: number; dy: number };
  seated: boolean;
}

const REST_L: ArmSpec = { target: [72, 258], bend: 1 };
const REST_R: ArmSpec = { target: [168, 258], bend: -1 };

/** One pose per mood. Targets are hand centres in viewBox units. */
export const POSES: Record<FayeMood, PoseSpec> = {
  idle: { describe: "standing calmly", L: REST_L, R: REST_R, lift: 0, sit: 0, head: { tilt: 0, dy: 0 }, seated: false },
  listening: {
    describe: "one hand cupped at the ear, head tilted toward you",
    L: { target: [60, 100], bend: -1, handRot: -12 },
    R: REST_R,
    lift: 0,
    sit: 0,
    head: { tilt: -6, dy: 0 },
    seated: false,
  },
  thinking: {
    describe: "one hand at the chin, the other arm across the waist",
    L: { target: [148, 204], bend: 1, handRot: 70 },
    R: { target: [133, 106], bend: -1, handRot: 20 },
    lift: 0,
    sit: 0,
    head: { tilt: 3, dy: 0 },
    seated: false,
  },
  speaking: {
    describe: "one open palm raised in a gesture",
    L: REST_L,
    R: { target: [206, 152], bend: 1, handRot: 12, open: true },
    lift: 0,
    sit: 0,
    head: { tilt: 0, dy: 0 },
    seated: false,
  },
  unsure: {
    describe: "a small shrug, palms out, head tilted",
    L: { target: [16, 148], bend: -1, handRot: -4, open: true },
    R: { target: [224, 148], bend: 1, handRot: 4, open: true },
    lift: -6,
    sit: 0,
    head: { tilt: 0, dy: -2 },
    seated: false,
  },
  celebrating: {
    describe: "both arms raised",
    L: { target: [44, 50], bend: -1, open: true },
    R: { target: [196, 50], bend: 1, open: true },
    lift: 0,
    sit: 0,
    head: { tilt: 0, dy: 0 },
    seated: false,
  },
  offline: {
    describe: "seated and powered down, resting",
    L: { target: [84, 300], bend: 1, handRot: 10 },
    R: { target: [156, 300], bend: -1, handRot: -10 },
    lift: 0,
    sit: 40,
    head: { tilt: 7, dy: 7 },
    seated: true,
  },
  error: {
    describe: "seated and powered down, something went wrong",
    L: { target: [84, 300], bend: 1, handRot: 10 },
    R: { target: [156, 300], bend: -1, handRot: -10 },
    lift: 0,
    sit: 40,
    head: { tilt: 7, dy: 7 },
    seated: true,
  },
};

// ------------------------------------------------------------------------------------------------------ the advisor
// Everything below is additive: Faye's rig, poses and geometry above are unchanged.

export type AdvisorSkin = "fair" | "tan" | "medium" | "mediumDeep" | "deep";
export type AdvisorSuit = "plum" | "teal" | "amber";
export type AdvisorHairColour = "black" | "espresso" | "chestnut";
export type AdvisorFrame = "rose" | "gold" | "ivory";

/** Skin swatches, light to deep. mediumDeep is the owner's choice and the default. */
export const ADVISOR_SKINS: Record<AdvisorSkin, { skin: TokenName; skinShade: TokenName }> = {
  fair: { skin: "skinFair", skinShade: "skinFairShade" },
  tan: { skin: "skinTan", skinShade: "skinTanShade" },
  medium: { skin: "skinMedium", skinShade: "skinMediumShade" },
  mediumDeep: { skin: "skinMediumDeep", skinShade: "skinMediumDeepShade" },
  deep: { skin: "skinDeep", skinShade: "skinDeepShade" },
};

/** Three pantsuit colourways: jacket, trousers (matching), lapel and piping. Default plum: distinct from Faye's ink-blue and teal and from Claude's amber. */
export const ADVISOR_SUITS: Record<AdvisorSuit, Pick<CharacterRig["outfit"], "jacket" | "jacketShade" | "lapel" | "piping" | "trousers" | "trousersShade">> = {
  plum: { jacket: "suitPlum", jacketShade: "suitPlumShade", lapel: "suitPlumShade", piping: "suitPlumLight", trousers: "suitPlum", trousersShade: "suitPlumShade" },
  teal: { jacket: "suitTeal", jacketShade: "suitTealShade", lapel: "suitTealShade", piping: "suitTealLight", trousers: "suitTeal", trousersShade: "suitTealShade" },
  amber: { jacket: "suitAmber", jacketShade: "suitAmberShade", lapel: "suitAmberShade", piping: "suitAmberLight", trousers: "suitAmber", trousersShade: "suitAmberShade" },
};

export const ADVISOR_HAIR: Record<AdvisorHairColour, TokenName> = { black: "hairBlack", espresso: "hairEspresso", chestnut: "hairChestnut" };
export const ADVISOR_FRAMES: Record<AdvisorFrame, TokenName> = { rose: "frameRose", gold: "frameGold", ivory: "frameIvory" };

export interface AdvisorChoices {
  skin?: AdvisorSkin;
  suit?: AdvisorSuit;
  hairStyle?: Exclude<HairStyle, "none">;
  hairColour?: AdvisorHairColour;
  glasses?: GlassesStyle;
  frame?: AdvisorFrame;
}

/** Build an advisor rig from the owner's choices; anything omitted takes the default (medium-deep skin, plum suit, full afro, soft-rectangle rose-gold glasses). */
export function advisorRig(c: AdvisorChoices = {}): CharacterRig {
  const skin = ADVISOR_SKINS[c.skin ?? "mediumDeep"] ?? ADVISOR_SKINS.mediumDeep;
  const suit = ADVISOR_SUITS[c.suit ?? "plum"] ?? ADVISOR_SUITS.plum;
  const hairStyle: HairStyle = c.hairStyle === "afroTapered" ? "afroTapered" : "afro";
  return {
    id: "advisor",
    displayName: "Advisor",
    skin: skin.skin,
    skinShade: skin.skinShade,
    hair: { style: hairStyle, colour: ADVISOR_HAIR[c.hairColour ?? "espresso"] ?? ADVISOR_HAIR.espresso },
    glasses: { style: c.glasses === "round" || c.glasses === "none" ? c.glasses : "softRect", colour: ADVISOR_FRAMES[c.frame ?? "rose"] ?? ADVISOR_FRAMES.rose },
    face: { lips: "lipBerry", eyeWhite: "blouseIvory", iris: "hairEspresso" },
    outfit: { ...suit, shirt: "blouseIvory", shoes: "shoeBlush", outline: "lineBright" },
  };
}

/** The advisor preset: medium-deep brown skin, full afro, soft-rectangle glasses, plum pantsuit, ivory blouse, blush flats. */
export const advisorDefault: CharacterRig = advisorRig();

/** Moods and poses the advisor has. A person does not power down, so offline and error map to idle (see AdvisorFullBody). */
export const ADVISOR_POSE_NAMES = ["idle", "listening", "thinking", "speaking", "presenting", "unsure", "celebrating"] as const;
export type AdvisorPose = (typeof ADVISOR_POSE_NAMES)[number];

/**
 * One pose per advisor pose. The arm solver, shoulders and lengths are the shared ones. "presenting" is new: the right
 * arm out to the side (toward a chart on the viewer's right), palm up, the head turned a little toward it.
 */
export const ADVISOR_POSES: Record<AdvisorPose, PoseSpec> = {
  idle: { ...POSES.idle, describe: "standing relaxed and confident" },
  listening: { ...POSES.listening, describe: "one hand at the ear, head tilted toward you" },
  thinking: { ...POSES.thinking, describe: "one hand at the chin, the other arm across the waist" },
  speaking: { ...POSES.speaking, describe: "one open palm raised, explaining" },
  presenting: {
    describe: "one arm out toward a chart",
    L: { target: [74, 256], bend: 1 },
    R: { target: [226, 150], bend: 1, handRot: 28, open: true },
    lift: 0,
    sit: 0,
    head: { tilt: 3, dy: 0 },
    seated: false,
  },
  unsure: { ...POSES.unsure, describe: "a small shrug, palms out" },
  celebrating: { ...POSES.celebrating, describe: "both arms raised in celebration" },
};
