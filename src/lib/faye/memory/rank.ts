/**
 * Ranking for memory retrieval (design 3.5). Pure functions.
 *
 * Score = 0.55 * term overlap with the question + 0.20 * recency + 0.15 * confidence + 0.10 * usefulness, times a category weight.
 * A note must overlap the question at all (and clear a floor) to be used. The only exception is the "style card": up to two
 * approved style notes ride along on every question because tone applies to every answer.
 * Hard budget (frozen in the contract): at most 6 notes and 900 characters in total (about 225 tokens).
 *
 * The tokenizer here is a small stemmer plus a stop list; it is NOT guaranteed identical to the Faye repo's corpus.py (that file
 * lives in another repository and was not read), so ranking quality is a Dellegate-side judgement, not a parity claim.
 */
import { computeMemoryPackHash } from "../mailbox/validate";
import type { MemoryPackV1 } from "../mailbox/types";
import { effectiveConfidence, isFaded, resolveSlotConflicts } from "./decay";
import { MEMORY_LIMITS } from "./config";
import { screenMemoryText } from "./redact";
import type { Candidate } from "./types";

const STOP = new Set(
  ("a an the and or but if then else of to in on at by for with from as is are was were be been being am do does did doing have has had having " +
    "i me my mine we us our you your yours he she it its they them their this that these those there here what which who whom whose when where " +
    "why how can could should would will shall may might must not no nor so than too very just also about into over under again more most some " +
    "any each other such only own same up down out off while during before after above below between through against once all both few " +
    "like likes want wants need needs please tell show give get got make made let lets ask asks asked question answer answers").split(" "),
);

/** Very small stemmer: plural, -ing, -ed, -ly, trailing e. Enough for "options" ~ "option" and "trading" ~ "trade". */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("ly")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().normalize("NFKC").split(/[^a-z0-9$]+/)) {
    const w = raw.replace(/^\$/, "");
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

const CATEGORY_WEIGHT: Record<string, number> = {
  style: 1.0,
  avoid: 1.0,
  preference: 0.9,
  goal: 0.8,
  context: 0.7,
  habit: 0.6,
  tendency: 0.5,
};

export const RANK = { termWeight: 0.55, recencyWeight: 0.2, confidenceWeight: 0.15, usefulnessWeight: 0.1, termFloor: 0.2, scoreFloor: 0.25 } as const;
const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 120;

export interface Scored {
  item: Candidate;
  score: number;
  term: number;
}

function recency(item: Candidate, now: number): number {
  const t = Date.parse(item.approved_at || item.updated_at);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now - t) / DAY_MS);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

/** Overlap of the question's tokens with the note's own tokens (fact words plus the slot name), 0..1. */
export function termOverlap(qTokens: Set<string>, item: Candidate): number {
  if (qTokens.size === 0) return 0;
  const it = tokens(`${item.fact} ${(item.slot ?? "").replace(/_/g, " ")}`);
  if (it.size === 0) return 0;
  let hit = 0;
  for (const w of it) if (qTokens.has(w)) hit++;
  return hit / Math.min(qTokens.size, it.size);
}

export function scoreItem(qTokens: Set<string>, item: Candidate, now: number): Scored {
  const term = Math.min(1, termOverlap(qTokens, item));
  const conf = effectiveConfidence(item, now) / 100;
  const useful = (Math.max(-5, Math.min(5, item.usefulness)) + 5) / 10;
  const base = RANK.termWeight * term + RANK.recencyWeight * recency(item, now) + RANK.confidenceWeight * conf + RANK.usefulnessWeight * useful;
  const w = CATEGORY_WEIGHT[item.category] ?? 0.5;
  return { item, term, score: base * w };
}

/** A note is usable in a prompt only if it passes the redaction list AGAIN (it may have entered by another path) and fits the pack rules. */
function packable(item: Candidate): string | null {
  const s = screenMemoryText(item.fact);
  if (!s.ok) return null;
  const t = s.text;
  if (t !== item.fact || t.length < 3 || t.length > 200) return null;
  return t;
}

/**
 * Picks the notes for one question. Returns null when nothing qualifies (an empty pack is never sent).
 * Deterministic for a given input and clock.
 */
export function buildPack(question: string, candidates: Candidate[], now: number): MemoryPackV1 | null {
  const live = resolveSlotConflicts(candidates.filter((c) => !isFaded(c, now)));
  const q = tokens(question);

  const chosen: { item: Candidate; text: string }[] = [];
  let chars = 0;
  const seen = new Set<string>();
  const tryAdd = (item: Candidate): void => {
    if (chosen.length >= MEMORY_LIMITS.packItems) return;
    const text = packable(item);
    if (text === null) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    if (chars + text.length > MEMORY_LIMITS.packChars) return;
    seen.add(key);
    chars += text.length;
    chosen.push({ item, text });
  };

  // 1. the always-on style card: the best two style notes (confidence, then recency)
  const styles = live
    .filter((c) => c.category === "style" && packable(c) !== null)
    .map((c) => ({ c, k: effectiveConfidence(c, now) + recency(c, now) }))
    .sort((a, b) => b.k - a.k || a.c.id.localeCompare(b.c.id))
    .slice(0, MEMORY_LIMITS.styleCard);
  for (const s of styles) tryAdd(s.c);

  // 2. everything else that is relevant to this question
  const used = new Set(chosen.map((c) => c.item.id));
  const ranked = live
    .filter((c) => !used.has(c.id))
    .map((c) => scoreItem(q, c, now))
    .filter((x) => x.term >= RANK.termFloor && x.score >= RANK.scoreFloor)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  for (const r of ranked) tryAdd(r.item);

  if (chosen.length === 0) return null;
  const items = chosen.map(({ item, text }) => ({ id: item.id, cat: item.category, t: text }));
  return { v: 1, items, chars, hash: computeMemoryPackHash(items) };
}
