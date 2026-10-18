/**
 * Pure helpers for the News hub. No network, no env, no React: everything here is unit-tested offline.
 *
 * Rules the hub follows (and these helpers enforce):
 *  - An item is a headline plus a link plus a source name plus a time. Never an article body.
 *  - Links must be http(s). Anything else is dropped.
 *  - A time says what it means: "published" (the outlet said so), "seen" (a crawler saw it) or "date" (date only).
 *  - Near-identical headlines are merged and the other sources are kept as "also from".
 */

export type NewsTimeKind = "published" | "seen" | "date";

export interface NewsItem {
  title: string;
  url: string;
  /** Plain outlet or site name, for example "CNBC" or "fool.com". */
  source: string;
  /** Which feed supplied it, for example "RSS", "Yahoo Finance feed", "FMP", "SEC EDGAR", "GDELT". */
  provider: string;
  /** ISO 8601 UTC string, or null when the feed gave no usable time. */
  publishedAt: string | null;
  timeKind: NewsTimeKind;
  kind: "news" | "press-release" | "filing";
  /** Other outlets that carried a near-identical headline. Filled by dedupeNews. */
  alsoFrom?: string[];
  /** True when the wording looks like opinion or promotion (a call to buy or sell, a price prediction). Shown as a label, never hidden. */
  opinion?: boolean;
}

export interface SourceStatus {
  /** Short name, for example "CNBC". */
  name: string;
  /** One plain sentence on what this source is. */
  what: string;
  ok: boolean;
  count: number;
  /** Plain-language reason when not ok. Never contains a URL or a key. */
  note: string | null;
}

export interface NewsSection {
  items: NewsItem[];
  sources: SourceStatus[];
  /** ISO time the data was assembled on the server. */
  asOf: string;
  /** Plain notes the reader should see (for example "Showing the Yahoo feed because FMP is off"). */
  notes: string[];
  /** Whole-section failure message in plain words, or null. */
  error: string | null;
}

export const MAX_TITLE_CHARS = 220;

/** Strips tags and entities left in a feed title, collapses spaces and caps the length. */
export function cleanTitle(raw: unknown): string {
  let s = String(raw ?? "");
  s = s.replace(/<[^>]*>/g, " ");
  s = s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&#x2019;|&#8217;/gi, "’")
    .replace(/&nbsp;/gi, " ");
  s = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > MAX_TITLE_CHARS) s = `${s.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return s;
}

const OPINION_PATTERNS: RegExp[] = [
  /\b(should|must|worth)\s+(you\s+)?(buy|sell|buying|selling|owning)\b/i,
  /\b(buy|sell)\s+(now|today|this|these|it|them|before|after)\b/i,
  /\b(buy|buying)\s+(on\s+)?the\s+dip\b/i,
  /\bshould you\b/i,
  /\b(best|top)\b.{0,30}\b(stocks?|etfs?|funds?|picks?)\b/i,
  /\b(to invest|invest(ed|ing)? \$|worth this much|could be worth)\b/i,
  /\bprediction[:s]?\b/i,
  /\b(could|will|might)\s+(soar|surge|skyrocket|crash|double|triple|10x|100x)\b/i,
  /\b\d{1,3}x\b/i,
  /\btake profits\b/i,
  /\b(my|i'm|i am|we're|we are)\s+(still\s+)?(buying|selling|holding)\b/i,
  /\b(undervalued|overvalued|no-brainer|must-own|next big)\b/i,
];

/**
 * True when a headline reads like opinion or a promotion (a call to buy or sell, a price prediction, a "best stock"
 * list). It is a reader-protection label: the headline is still shown as written. It is a plain word match, so it
 * will miss some and flag some that are not.
 */
export function looksLikeOpinion(title: string): boolean {
  return OPINION_PATTERNS.some((p) => p.test(title));
}

/** Returns the URL as a normalized string when it is a plain http(s) link, otherwise null. */
export function safeHttpUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_|mod$|ref$|\.?tsrc$|cmpid|taid|guccounter)/i;

/** Removes tracking parameters from an outbound link. Other parameters are kept. */
export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** Key used to tell whether two links are the same page: host without www, path without trailing slash, no tracking params. */
export function canonicalUrlKey(url: string): string {
  try {
    const u = new URL(url);
    const keep: string[] = [];
    for (const [k, v] of u.searchParams) if (!TRACKING_PARAM.test(k)) keep.push(`${k}=${v}`);
    keep.sort();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${keep.length ? `?${keep.join("&")}` : ""}`;
  } catch {
    return url;
  }
}

/** Host name without "www.", used as the outlet name when a feed does not give one. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Parses the time formats feeds use: RFC 822 ("Sat, 17 Oct 2026 20:07:00 +0000"), ISO 8601, GDELT's compact
 * "20261017T200700Z", and a bare date. Returns an ISO UTC string and whether it is date only, or null.
 */
export function parseFeedTime(raw: unknown, now: number = Date.now()): { iso: string; dateOnly: boolean } | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const g = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
  let ms: number;
  let dateOnly = false;
  if (g) {
    ms = Date.UTC(Number(g[1]), Number(g[2]) - 1, Number(g[3]), Number(g[4]), Number(g[5]), Number(g[6]));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    ms = Date.parse(`${s}T00:00:00Z`);
    dateOnly = true;
  } else {
    // "2026-10-17 14:05:00" has no zone; treat it as UTC rather than the server's zone.
    const withZone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
    ms = Date.parse(withZone);
  }
  if (!Number.isFinite(ms)) return null;
  // A time more than a day in the future is a feed error, not news.
  if (ms > now + 24 * 3600_000) return null;
  // Years before 2000 are parse junk for a news feed.
  if (ms < Date.UTC(2000, 0, 1)) return null;
  return { iso: new Date(ms).toISOString(), dateOnly };
}

const STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his how if in into is it its may more most new no not of on or our over per says say said she so than that the their them then there these they this to up us was we were what when where which who why will with would you your after before about amid among against off out down just now today here via vs".split(
    " "
  )
);

function wordsOf(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[‘’']s\b/g, "")
    .replace(/[^a-z0-9$%.\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length > 0);
}

/** Removes a trailing " - Outlet" or " | Outlet" that some feeds add to titles. */
function stripOutletSuffix(title: string): string {
  return title.replace(/\s+[-–—|]\s+[A-Z][\w .&']{1,30}$/, "");
}

/** Normalized word list used for near-duplicate checks. */
export function titleTokens(title: string): string[] {
  return wordsOf(stripOutletSuffix(title)).filter((w) => !STOPWORDS.has(w));
}

/** Jaccard similarity of two token sets, 0..1. */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** Two headlines this similar (and with enough words to judge) are treated as the same story. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;
const MIN_TOKENS_FOR_FUZZY = 4;

function timeMs(i: NewsItem): number {
  if (!i.publishedAt) return -Infinity;
  const t = Date.parse(i.publishedAt);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Drops items with an unusable title or link, then merges near-identical headlines. Two items merge when they share a
 * canonical URL, an identical normalized title, or a token similarity of at least NEAR_DUPLICATE_THRESHOLD (with at
 * least 4 meaningful words each, so short titles are never merged by fuzzy match). The newest item is kept as the
 * main entry; other outlets are listed in alsoFrom. Output is newest first, undated items last.
 */
export function dedupeNews(input: NewsItem[]): NewsItem[] {
  const sorted = input
    .filter((i) => i.title && safeHttpUrl(i.url))
    .slice()
    .sort((a, b) => timeMs(b) - timeMs(a));
  const kept: { item: NewsItem; tokens: string[]; urlKey: string; norm: string }[] = [];
  for (const item of sorted) {
    const tokens = titleTokens(item.title);
    const urlKey = canonicalUrlKey(item.url);
    const norm = tokens.join(" ");
    const match = kept.find(
      (k) =>
        k.urlKey === urlKey ||
        (norm !== "" && k.norm === norm) ||
        (tokens.length >= MIN_TOKENS_FOR_FUZZY && k.tokens.length >= MIN_TOKENS_FOR_FUZZY && tokenSimilarity(tokens, k.tokens) >= NEAR_DUPLICATE_THRESHOLD)
    );
    if (match) {
      const also = new Set(match.item.alsoFrom ?? []);
      if (item.source !== match.item.source) also.add(item.source);
      for (const s of item.alsoFrom ?? []) if (s !== match.item.source) also.add(s);
      match.item = { ...match.item, alsoFrom: [...also] };
    } else {
      kept.push({ item: { ...item }, tokens, urlKey, norm });
    }
  }
  return kept.map((k) => k.item);
}

export interface TrendingTopic {
  term: string;
  /** Number of different outlets that used the term in a headline. */
  outlets: number;
  headlines: number;
  examples: { title: string; url: string; source: string }[];
}

const GENERIC_CAPS = new Set(["ceo", "cfo", "usa", "uk", "eu", "ipo", "etf", "gdp", "tv", "pm", "am"]);
const WEAK_WORDS = new Set(
  "world global news million billion stock stocks market markets shares share price prices week year years month day days first big biggest top best latest live update updates report reports trading traders investors investor company companies business economy economic".split(
    " "
  )
);

/**
 * Finds words and two-word phrases that appear in headlines from at least `minOutlets` different outlets. This counts
 * headlines. It does not say why a price moved, and a topic can be loud because of an old story.
 * Input should already be deduped, so one story carried by many outlets counts once per outlet.
 */
export function findTrendingTopics(items: NewsItem[], opts: { minOutlets?: number; limit?: number } = {}): TrendingTopic[] {
  const minOutlets = opts.minOutlets ?? 3;
  const limit = opts.limit ?? 8;
  const sourcesOf = new Map<string, Set<string>>();
  const headlinesOf = new Map<string, NewsItem[]>();
  const useful = (w: string) => w.length >= 3 && !STOPWORDS.has(w) && !WEAK_WORDS.has(w) && !GENERIC_CAPS.has(w) && !/^[\d.,]+%?$/.test(w);
  for (const item of items) {
    const words = wordsOf(stripOutletSuffix(item.title));
    const terms = new Set<string>();
    for (const w of words) if (useful(w)) terms.add(w);
    for (let i = 0; i < words.length - 1; i += 1) {
      if (useful(words[i]) && useful(words[i + 1])) terms.add(`${words[i]} ${words[i + 1]}`);
    }
    // Count the outlet that printed it plus any outlets merged into it by dedupe.
    const outlets = [item.source, ...(item.alsoFrom ?? [])];
    for (const t of terms) {
      if (!sourcesOf.has(t)) sourcesOf.set(t, new Set());
      for (const o of outlets) sourcesOf.get(t)!.add(o);
      if (!headlinesOf.has(t)) headlinesOf.set(t, []);
      headlinesOf.get(t)!.push(item);
    }
  }
  const candidates = [...sourcesOf.entries()]
    .filter(([, srcs]) => srcs.size >= minOutlets)
    .map(([term, srcs]) => ({ term, outlets: srcs.size, headlines: headlinesOf.get(term)!.length, hs: headlinesOf.get(term)! }));
  candidates.sort(
    (a, b) => b.outlets - a.outlets || b.term.split(" ").length - a.term.split(" ").length || b.headlines - a.headlines || a.term.localeCompare(b.term)
  );
  const chosen: typeof candidates = [];
  for (const c of candidates) {
    // Skip a word already inside a kept phrase, and skip anything that points at the same headlines as a kept topic.
    const insideKept = chosen.some((k) => k.term.includes(c.term));
    const sameStory = chosen.some((k) => sharedShare(k.hs, c.hs) >= 0.8);
    if (insideKept || sameStory) continue;
    chosen.push(c);
    if (chosen.length >= limit) break;
  }
  return chosen.map((c) => ({
    term: c.term,
    outlets: c.outlets,
    headlines: c.headlines,
    examples: c.hs.slice(0, 3).map((h) => ({ title: h.title, url: h.url, source: h.source })),
  }));
}

function sharedShare(a: NewsItem[], b: NewsItem[]): number {
  const sa = new Set(a.map((i) => i.url));
  let shared = 0;
  for (const i of b) if (sa.has(i.url)) shared += 1;
  return shared / Math.max(1, Math.min(a.length, b.length));
}

/**
 * Turns an error from a provider into one plain sentence. The raw message may contain a path or a provider body, so it
 * is never passed through. The hub shows only what this returns.
 */
export function friendlyError(err: unknown, sourceName: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  if (/is not set|not configured|missing .*key/.test(lower)) return `${sourceName} is not set up yet (no key). It is off for now.`;
  if (/\b(401|402|403)\b|invalid api key|restricted endpoint|unauthori[sz]ed|forbidden/.test(lower)) {
    return `${sourceName} refused the request. It needs a valid key or a paid plan, so it is off for now.`;
  }
  if (/\b429\b|too many|rate.?limit|limit requests/.test(lower)) return `${sourceName} is limiting requests right now. Try again in a few minutes.`;
  if (/timed out|timeout|abort/.test(lower)) return `${sourceName} took too long to answer.`;
  if (/\b404\b|not found/.test(lower)) return `${sourceName} no longer has this feed.`;
  return `${sourceName} did not answer.`;
}

/** Ticker and pair symbols the hub accepts. Letters, digits and a few separators, 1 to 20 characters. */
export const HUB_SYMBOL_RE = /^[A-Za-z0-9^][A-Za-z0-9.=/_^-]{0,19}$/;

export function isHubSymbol(s: unknown): s is string {
  return typeof s === "string" && HUB_SYMBOL_RE.test(s);
}

/** Maps an app symbol to the symbol Yahoo's feed expects (forex "EUR/USD" -> "EURUSD=X", crypto "BTC/USD" -> "BTC-USD"). */
export function toYahooSymbol(symbol: string, assetClass: string): string {
  const s = symbol.trim().toUpperCase();
  if (assetClass === "forex") {
    const flat = s.replace(/[/_-]/g, "");
    return /^[A-Z]{6}$/.test(flat) ? `${flat}=X` : s;
  }
  if (assetClass === "crypto") {
    const m = /^([A-Z0-9]{2,10})[/_-]?(USD|USDT|USDC)$/.exec(s);
    return m ? `${m[1]}-USD` : s;
  }
  return s;
}

export const HUB_NOTE_NOT_ADVICE = "Headlines are information, not advice.";
export const HUB_NOTE_AS_WRITTEN = "Some outlets write opinion or promotional headlines. We show each one as the outlet wrote it.";

/** Small in-process TTL cache with in-flight de-duplication. Per server instance: a politeness measure, not a guarantee. */
export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();
  constructor(private ttlMs: number, private maxEntries = 200) {}

  async get(key: string, load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
    const hit = this.store.get(key);
    if (hit && now() - hit.at < this.ttlMs) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load()
      .then((value) => {
        this.store.set(key, { at: now(), value });
        if (this.store.size > this.maxEntries) {
          const oldest = [...this.store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) this.store.delete(oldest[0]);
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  clear() {
    this.store.clear();
    this.inflight.clear();
  }
}

/** "just now", "12 min ago", "5 h ago", "3 days ago". Future times (clock drift) read as "just now". */
export function relativeAge(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((nowMs - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * Text for the time on one item, always saying what the time means.
 *   published  "Oct 17, 4:07 PM EDT (3 h ago)"
 *   seen       "First seen by GDELT Oct 17, 4:07 PM EDT (3 h ago)"
 *   date       "Oct 17 (date only)"
 *   none       "Time not given"
 * timeZone is an IANA name (default: the viewer's own zone).
 */
export function describeNewsTime(item: Pick<NewsItem, "publishedAt" | "timeKind" | "provider">, nowMs: number = Date.now(), timeZone?: string): string {
  if (!item.publishedAt) return "Time not given";
  const d = new Date(item.publishedAt);
  if (Number.isNaN(d.getTime())) return "Time not given";
  if (item.timeKind === "date") {
    const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
    return `${day} (date only)`;
  }
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) }).format(d);
  const age = relativeAge(item.publishedAt, nowMs);
  const base = `${when}${age ? ` (${age})` : ""}`;
  return item.timeKind === "seen" ? `First seen by ${item.provider} ${base}` : base;
}
