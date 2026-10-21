/**
 * Deterministic extractors for Faye memory (design 3.4). Pure functions, no I/O, no model.
 *
 * THESE FUNCTIONS READ ONLY THE OWNER'S OWN TYPED WORDS. Never pass them model output, tool output, page text or a web page: an
 * injected page must not be able to write memory (threat T1). The route that calls them requires `from: "typed"` in the request
 * and rejects anything else; this file cannot check where a string came from, so the rule is repeated here on purpose.
 *
 * What is extracted:
 *   1. Explicit commands, anchored at the start of the message: "remember that ...", "forget that ...", "that is wrong, I actually ...".
 *      These are saved at once (the owner said it) as `stated`, status approved.
 *   2. A small closed set of safe first-person patterns (answer style, "call me X", a stated goal, a trading horizon or instrument).
 *      These only ever become PROPOSALS (status proposed) for the owner to approve.
 *   3. Usage counters (topic, ticker, hour). Only the counts are kept, never the message text; a threshold rule turns counts into
 *      proposals ("Often asks about options.") whose evidence is a counter in source_ref.
 */
import type { MemoryCategory, NoteCandidate, UsageDay } from "./types";

// -------------------------------------------------------------------------------------------------------------- commands

export type Command =
  | { kind: "none" }
  | { kind: "remember"; body: string }
  | { kind: "correct"; body: string }
  | { kind: "forget"; target: string }
  | { kind: "forget_all" };

const PREAMBLE = String.raw`^\s*(?:(?:hey|hi|ok|okay)[\s,]+)?(?:faye[\s,:-]+)?(?:please\s+|pls\s+)?`;

const REMEMBER = new RegExp(PREAMBLE + String.raw`(?:remember|keep\s+in\s+mind)(?:\s+that\b|\s*[:,-]|\s+(?=(?:i|i'm|i’m|my|me|to|we)\b))\s*(.+)$`, "is");
const CORRECT = new RegExp(
  PREAMBLE + String.raw`(?:(?:that|this|it)(?:'s|’s|\s+is)\s+(?:wrong|incorrect|not\s+right|not\s+true|outdated|out\s+of\s+date)|correction)\s*[,;:.-]+\s*(.+)$`,
  "is",
);
const FORGET_ALL = new RegExp(
  PREAMBLE + String.raw`(?:forget|delete|erase|wipe|clear)\s+(?:everything|all)(?:\s+(?:you\s+)?(?:know|remember)(?:\s+about\s+me)?|\s+about\s+me|\s+(?:my\s+)?(?:memory|notes|data))?\s*[.!]*\s*$`,
  "i",
);
const FORGET = new RegExp(
  PREAMBLE + String.raw`(?:forget|delete|remove)\s+(?:that|what\s+i\s+(?:said|told\s+you)|the\s+note|my\s+note|the\s+memory|my\s+memory)\s*(?:about|that|on|regarding|:)?\s*(.+)$`,
  "is",
);

/** Detects an explicit memory command. A question (ends with "?") is never a command. */
export function parseCommand(message: unknown): Command {
  if (typeof message !== "string") return { kind: "none" };
  const m = message.replace(/\s+/g, " ").trim();
  if (m.length === 0 || m.length > 600 || m.endsWith("?")) return { kind: "none" };
  if (FORGET_ALL.test(m)) return { kind: "forget_all" };
  let r = CORRECT.exec(m);
  if (r) return { kind: "correct", body: r[1].trim() };
  r = FORGET.exec(m);
  if (r) return { kind: "forget", target: r[1].trim() };
  r = REMEMBER.exec(m);
  if (r && r[1].trim().length >= 2) return { kind: "remember", body: r[1].trim() };
  return { kind: "none" };
}

// ------------------------------------------------------------------------------------------------ first person to third person

const IRREGULAR: Record<string, string> = { have: "has", do: "does", go: "goes", am: "is", are: "is" };
const ADVERBS = new Set(["usually", "often", "always", "mostly", "mainly", "typically", "also", "really", "never", "only", "just", "still", "generally", "normally", "actually", "now", "currently"]);

function conjugate(verb: string): string {
  const v = verb.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v];
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + "es";
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ies";
  return v + "s";
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Rewrites "I like the number first" as "Likes the number first." Unrecognised openings are kept in the owner's words. */
export function toNote(input: string): string {
  let s = input.replace(/\s+/g, " ").trim().replace(/^that\s+/i, "").replace(/[\s.!;,]+$/, "");
  if (s.length === 0) return "";
  const lead = /^(?:i(?:'|’)m|i\s+am)\s+(.*)$/i.exec(s);
  if (lead) {
    s = "is " + lead[1];
  } else {
    const adv: string[] = [];
    let rest = s;
    const first = /^i\s+(.*)$/i.exec(rest);
    if (first) {
      rest = first[1];
      for (;;) {
        const w = /^(\w+)\s+(.*)$/.exec(rest);
        if (w && ADVERBS.has(w[1].toLowerCase())) {
          adv.push(w[1].toLowerCase());
          rest = w[2];
        } else break;
      }
      const neg = /^(?:do\s+not|don(?:'|’)?t|dont)\s+(.*)$/i.exec(rest);
      const have = /^(?:have\s+not|haven(?:'|’)?t)\s+(.*)$/i.exec(rest);
      if (neg) rest = "does not " + neg[1];
      else if (have) rest = "has not " + have[1];
      else {
        const v = /^(\w+)(\s+.*)?$/.exec(rest);
        if (v) rest = conjugate(v[1]) + (v[2] ?? "");
      }
      s = [...adv, rest].join(" ");
    } else {
      const my = /^my\s+(.*)$/i.exec(s);
      if (my) s = "their " + my[1];
    }
  }
  // any first-person word left inside the sentence
  s = s
    .replace(/\bI(?:'|’)m\b/g, "they are")
    .replace(/\bI(?:'|’)d\b/g, "they would")
    .replace(/\bI(?:'|’)ll\b/g, "they will")
    .replace(/\bI(?:'|’)ve\b/g, "they have")
    .replace(/\bI\b/g, "they")
    .replace(/\bmy\b/gi, "their")
    .replace(/\bmyself\b/gi, "themselves")
    .replace(/\bme\b/gi, "them")
    .replace(/\bmine\b/gi, "theirs");
  return capitalize(s) + ".";
}

// -------------------------------------------------------------------------------------------------- category and slot

export interface Classified {
  category: MemoryCategory;
  slot: string | null;
}

/** Deterministic category and slot for a note. A slot lets a newer note replace an older one. */
export function classifyNote(fact: string): Classified {
  const f = fact.toLowerCase();
  if (/\b(called|goes\s+by|call\s+them)\b/.test(f)) return { category: "preference", slot: "address_name" };
  if (/\b(number|numbers|answer|bottom\s+line|why)\s+first\b|\blead(s)?\s+with\s+the\b/.test(f)) return { category: "style", slot: "answer_order" };
  if (/\b(short|shorter|brief|concise|terse|detailed|in[- ]depth|longer|long|verbose)\b.{0,30}\b(answers?|repl(?:y|ies)|responses?|explanations?)\b|\b(answers?|repl(?:y|ies)|responses?|explanations?)\b.{0,30}\b(short|brief|concise|detailed|long)\b/.test(f)) {
    return { category: "style", slot: "answer_length" };
  }
  if (/\b(jokes?|humou?r|funny|playful|serious|formal|casual|friendly|dry|blunt|direct)\b/.test(f)) {
    return { category: /\b(not|no|dislikes?|avoid|hates?|without)\b/.test(f) ? "avoid" : "style", slot: "tone" };
  }
  if (/\b(bullets?|bullet\s+points|tables?|lists?|paragraphs?|charts?)\b/.test(f)) return { category: "style", slot: "format" };
  if (/\b(avoid|does\s+not\s+want|do\s+not\s+want|dislikes?|hates?|not\s+interested|never\s+(?:use|show|mention))\b/.test(f)) return { category: "avoid", slot: null };
  if (/\b(goal|aim|aiming|studying|study\s+for|preparing\s+for|working\s+toward|wants\s+to\s+become|plans?\s+to|planning\s+to)\b/.test(f)) return { category: "goal", slot: null };
  if (/\b(day\s+trad\w*|swing|scalp\w*|long[- ]term|buy\s+and\s+hold|intraday)\b/.test(f)) return { category: "preference", slot: "horizon" };
  if (/\b(usually|often|every\s+(?:day|week|morning)|each\s+(?:day|week|morning)|regularly|typically|tends?\s+to)\b/.test(f)) return { category: "habit", slot: null };
  if (/\b(prefers?|likes?|loves?|favou?rite|enjoys?|wants?)\b/.test(f)) return { category: "preference", slot: null };
  return { category: "context", slot: null };
}

/** Turns the body of a command into a candidate note (not yet screened). Returns null when there is nothing to save. */
export function noteFromBody(body: string): { fact: string; category: MemoryCategory; slot: string | null } | null {
  const call = /^(?:call\s+me|my\s+name\s+is)\s+([A-Za-z][A-Za-z'’-]{0,24})\s*[.!]*$/i.exec(body.trim());
  if (call) {
    const name = capitalize(call[1].toLowerCase());
    return { fact: `Likes to be called ${name}.`, category: "preference", slot: "address_name" };
  }
  const fact = toNote(body);
  if (fact.length < 3) return null;
  return { fact, ...classifyNote(fact) };
}

// ---------------------------------------------------------------------------------------------- safe first-person patterns

interface Pattern {
  id: string;
  re: RegExp;
  make: (m: RegExpExecArray) => { fact: string; category: MemoryCategory; slot: string | null } | null;
}

const HORIZONS: [RegExp, string][] = [
  [/\bday[\s-]?trad\w*/, "Prefers day trading."],
  [/\bswing\s+trad\w*|\btrade\s+(?:weekly\s+)?swings?\b|\bweekly\s+swings?\b/, "Prefers swing trades."],
  [/\blong[\s-]term\s+invest\w*|\binvest\s+long[\s-]term\b/, "Prefers long-term investing."],
];
const INSTRUMENTS = ["options", "futures", "etfs", "stocks", "crypto", "forex"] as const;

const PATTERNS: Pattern[] = [
  {
    id: "answer_order",
    re: /\bi(?:'d|’d|\s+would)?\s+(?:really\s+)?(?:like|prefer|want|love)\s+(?:the\s+)?(?:numbers?|answer|bottom\s+line)\s+first\b/i,
    make: () => ({ fact: "Likes the number first.", category: "style", slot: "answer_order" }),
  },
  {
    id: "answer_length_short",
    re: /\bi(?:'d|’d|\s+would)?\s+(?:really\s+)?(?:like|prefer|want)\s+(?:short|brief|concise)\s+(?:answers?|replies|responses?)\b/i,
    make: () => ({ fact: "Likes short answers.", category: "style", slot: "answer_length" }),
  },
  {
    id: "answer_length_long",
    re: /\bi(?:'d|’d|\s+would)?\s+(?:really\s+)?(?:like|prefer|want)\s+(?:detailed|in[\s-]depth|long)\s+(?:answers?|replies|responses?|explanations?)\b/i,
    make: () => ({ fact: "Likes detailed answers.", category: "style", slot: "answer_length" }),
  },
  {
    id: "no_jokes",
    re: /\bi\s+(?:don(?:'|’)?t|do\s+not)\s+(?:like|want|need)\s+(?:any\s+)?(?:jokes?|humou?r)\b/i,
    make: () => ({ fact: "Does not want jokes.", category: "avoid", slot: "tone" }),
  },
  {
    id: "call_me",
    re: /^\s*(?:please\s+)?call\s+me\s+([A-Za-z][A-Za-z'’-]{0,24})\s*[.!]*\s*$/i,
    make: (m) => ({ fact: `Likes to be called ${capitalize(m[1].toLowerCase())}.`, category: "preference", slot: "address_name" }),
  },
  {
    id: "horizon",
    re: /\bi\s+(?:mostly\s+|usually\s+|mainly\s+|typically\s+)?(?:prefer|like|love|do|trade|am|invest)\b[^.!?]{0,60}/i,
    make: (m) => {
      const hit = HORIZONS.find(([re]) => re.test(m[0].toLowerCase()));
      return hit ? { fact: hit[1], category: "preference", slot: "horizon" } : null;
    },
  },
  {
    id: "instrument",
    re: /\bi\s+(?:mostly|usually|mainly|only|typically)\s+trade\s+([a-z]+)\b/i,
    make: (m) => {
      const inst = m[1].toLowerCase();
      return (INSTRUMENTS as readonly string[]).includes(inst) ? { fact: `Mostly trades ${inst === "etfs" ? "ETFs" : inst}.`, category: "habit", slot: null } : null;
    },
  },
  {
    id: "goal",
    re: /\bmy\s+goal\s+is\s+(?:to\s+)?([^.!?\n]{4,100})/i,
    make: (m) => {
      const rest = toNote(m[1]).replace(/\.$/, "");
      return { fact: `Goal is to ${rest.charAt(0).toLowerCase()}${rest.slice(1)}.`, category: "goal", slot: null };
    },
  },
];

/** Proposals from the owner's own sentence (at most 3). The caller must still screen every fact. */
export function extractSafePatterns(message: unknown): NoteCandidate[] {
  if (typeof message !== "string" || message.length === 0 || message.length > 600) return [];
  const msg = message.replace(/\s+/g, " ").trim();
  const out: NoteCandidate[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    const m = p.re.exec(msg);
    if (!m) continue;
    const made = p.make(m);
    if (!made || seen.has(made.fact.toLowerCase())) continue;
    seen.add(made.fact.toLowerCase());
    out.push({ category: made.category, slot: made.slot, fact: made.fact, source: "stated", sourceRef: `pattern:${p.id}`, confidence: 70 });
    if (out.length >= 3) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ usage counters

const TOPICS: [string, RegExp][] = [
  ["options", /\b(options?|calls?|puts?|straddles?|strangles?|spreads?|iron\s+condors?|theta|delta|gamma|vega|iv|implied\s+vol\w*|gex|open\s+interest|expir\w+|strike)\b/i],
  ["volatility", /\b(volatil\w+|vix|vol|atr|vrp|realized\s+vol\w*)\b/i],
  ["earnings", /\b(earnings?|eps|guidance|10-?[kq]|revenue|margins?|conference\s+call)\b/i],
  ["macro", /\b(fed|fomc|cpi|ppi|inflation|rates?|yield\s+curve|treasur\w+|gdp|jobs\s+report|nfp|recession|macro)\b/i],
  ["portfolio", /\b(portfolio|positions?|holdings?|allocation|diversif\w+|rebalanc\w+|exposure|cost\s+basis)\b/i],
  ["crypto", /\b(bitcoin|btc|ethereum|eth|crypto\w*|blockchain|defi|stablecoins?|solana)\b/i],
  ["fx", /\b(forex|fx|eur\/?usd|usd\/?jpy|gbp\/?jpy|yen|currency|currencies)\b/i],
  ["technicals", /\b(rsi|macd|moving\s+average|vwap|support|resistance|breakout|chart|candle\w*|trend\w*|bollinger)\b/i],
  ["valuation", /\b(valuation|p\/e|pe\s+ratio|dcf|multiples?|ev\/ebitda|fair\s+value|intrinsic)\b/i],
  ["education", /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|define|meaning\s+of|difference\s+between)\b/i],
];

const TOPIC_LABEL: Record<string, string> = {
  options: "options",
  volatility: "volatility",
  earnings: "earnings",
  macro: "macro news",
  portfolio: "their portfolio",
  crypto: "crypto",
  fx: "currencies",
  technicals: "technical analysis",
  valuation: "valuation",
  education: "how things work",
};

/** Up to three topic keys that the message touches. Keys match the database whitelist ^[a-z_]{1,24}$. */
export function classifyTopics(message: unknown): string[] {
  if (typeof message !== "string") return [];
  const out: string[] = [];
  for (const [key, re] of TOPICS) if (re.test(message)) out.push(key);
  return out.slice(0, 3);
}

const TICKER_STOP = new Set([
  "I", "A", "AM", "PM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "CAN", "HOW", "WHAT", "WHY", "WHEN", "WHO", "ETF", "GEX", "IV", "RSI", "EPS", "CEO", "CFO",
  "USD", "EUR", "GBP", "JPY", "FX", "PE", "DCF", "OK", "VS", "VIX", "FED", "CPI", "PPI", "GDP", "NFP", "ATR", "VWAP", "SEC", "IRS", "USA", "AI", "API", "FAQ",
  "TLDR", "ASAP", "FOMC", "YTD", "ROI", "OTM", "ITM", "ATM", "DTE", "BTC", "ETH", "LOL", "IMO", "FYI",
]);

/** Ticker-looking tokens: $NVDA anywhere, or ALL-CAPS words of 2 to 5 letters when the message is not shouted. At most 5. */
export function extractTickers(message: unknown): string[] {
  if (typeof message !== "string") return [];
  const out = new Set<string>();
  for (const m of message.matchAll(/\$([A-Za-z]{1,5})\b/g)) out.add(m[1].toUpperCase());
  const letters = message.replace(/[^A-Za-z]/g, "");
  const upperRatio = letters.length === 0 ? 0 : letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.5) {
    for (const m of message.matchAll(/\b([A-Z]{2,5})\b/g)) if (!TICKER_STOP.has(m[1])) out.add(m[1]);
  }
  return [...out].filter((x) => /^[A-Z]{1,5}$/.test(x) && !TICKER_STOP.has(x)).slice(0, 5);
}

/** Hour of day (0..23) and calendar day (YYYY-MM-DD) of `now` in an IANA time zone; unknown zones fall back to UTC. */
export function localClock(now: number, tz: unknown): { hour: number; day: string; tz: string } {
  const zone = typeof tz === "string" && /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/.test(tz) && tz.length <= 40 ? tz : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    const day = `${get("year")}-${get("month")}-${get("day")}`;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("bad clock");
    return { hour, day, tz: zone };
  } catch {
    const d = new Date(now);
    return { hour: d.getUTCHours(), day: d.toISOString().slice(0, 10), tz: "UTC" };
  }
}

// ------------------------------------------------------------------------------------------ counts to proposals

export const HABIT_RULES = {
  windowDays: 30,
  minQuestions: 10,
  topicMinCount: 6,
  topicMinShare: 0.4,
  tickerMinCount: 5,
  tickerMinDays: 3,
  hoursMinQuestions: 15,
  hoursMinShare: 0.5,
} as const;

const two = (n: number) => String(n).padStart(2, "0");

/** Turns the last 30 days of counts into at most 5 proposals. Pure; the text of a question is not an input. */
export function proposeFromStats(rows: UsageDay[], tzLabel = "UTC"): NoteCandidate[] {
  const total = rows.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  if (total < HABIT_RULES.minQuestions) return [];
  const out: NoteCandidate[] = [];

  const topics = new Map<string, number>();
  const tickers = new Map<string, { n: number; days: number }>();
  const hours = new Array<number>(24).fill(0);
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.topic_counts ?? {})) topics.set(k, (topics.get(k) ?? 0) + Number(v));
    for (const [k, v] of Object.entries(r.ticker_counts ?? {})) {
      const cur = tickers.get(k) ?? { n: 0, days: 0 };
      cur.n += Number(v);
      cur.days += 1;
      tickers.set(k, cur);
    }
    for (const [k, v] of Object.entries(r.hour_hist ?? {})) {
      const h = Number(k);
      if (Number.isInteger(h) && h >= 0 && h < 24) hours[h] += Number(v);
    }
  }

  const topTopics = [...topics.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2);
  for (const [key, n] of topTopics) {
    const label = TOPIC_LABEL[key];
    if (!label || n < HABIT_RULES.topicMinCount || n / total < HABIT_RULES.topicMinShare) continue;
    out.push({
      category: "habit",
      slot: `topic_${key}`,
      fact: `Often asks about ${label}.`,
      source: "observed",
      sourceRef: `stats:topic=${key},n=${n},of=${total}`,
      confidence: Math.min(70, 40 + 3 * (n - HABIT_RULES.topicMinCount)),
    });
  }

  const topTickers = [...tickers.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 2);
  for (const [sym, v] of topTickers) {
    if (v.n < HABIT_RULES.tickerMinCount || v.days < HABIT_RULES.tickerMinDays || !/^[A-Z]{1,5}$/.test(sym)) continue;
    out.push({
      category: "habit",
      slot: `watch_${sym.toLowerCase()}`,
      fact: `Often asks about ${sym}.`,
      source: "observed",
      sourceRef: `stats:ticker=${sym},n=${v.n},days=${v.days}`,
      confidence: Math.min(70, 40 + 3 * (v.n - HABIT_RULES.tickerMinCount)),
    });
  }

  const hourTotal = hours.reduce((a, b) => a + b, 0);
  if (hourTotal >= HABIT_RULES.hoursMinQuestions) {
    let best = -1;
    let bestN = 0;
    for (let h = 0; h < 24; h++) {
      if (hours[h] === 0) continue; // a window starts at an hour that was actually used
      const n = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
      if (n > bestN) {
        bestN = n;
        best = h;
      }
    }
    if (best >= 0 && bestN / hourTotal >= HABIT_RULES.hoursMinShare) {
      const end = (best + 3) % 24;
      out.push({
        category: "tendency",
        slot: "active_hours",
        fact: `Usually asks between ${two(best)}:00 and ${two(end)}:00 (${tzLabel}).`,
        source: "observed",
        sourceRef: `stats:hours=${two(best)},n=${bestN},of=${hourTotal}`,
        confidence: Math.min(70, 40 + Math.round(30 * (bestN / hourTotal - HABIT_RULES.hoursMinShare) * 2)),
      });
    }
  }
  return out.slice(0, 5);
}
