import type { FetchReport, MarketCandle } from "./market-data-types";

/**
 * Shared HTTP and data-cleaning helpers for every market-data provider client.
 *
 * - providerFetch: a timeout on every request (15 s default), and up to 2 retries with backoff on 429 and 5xx that
 *   honour Retry-After. A provider that never answers can no longer hold a whole Promise.all (watchlist scan, rates
 *   poll, hypothesis sweep) until the platform kills the function.
 * - snapWindow: rounds a [start, end] request window to the cache window, so two calls made seconds apart build the
 *   same URL and Next's data cache can actually hit (callers pass Date.now()-based windows).
 * - cleanCandles: drops bars that are not usable (missing/NaN/non-positive fields, high < low, duplicate timestamps),
 *   sorts ascending and says how many it dropped.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_RETRIES = 2;
/** A Retry-After longer than this is not waited out (the serverless function would be killed first): the error is thrown instead. */
export const MAX_RETRY_WAIT_MS = 10_000;
const BACKOFF_BASE_MS = 400;

let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
/** Test hook: replace the sleep used between retries (fake timers). Pass undefined to restore. */
export function setProviderSleep(fn?: (ms: number) => Promise<void>): void {
  sleepImpl = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

let timeoutOverrideMs: number | undefined;
/** Test hook: force every provider timeout to this many ms (so a hang test takes milliseconds). Pass undefined to restore. */
export function setProviderTimeoutMs(ms?: number): void {
  timeoutOverrideMs = ms;
}

export interface ProviderFetchOptions {
  /** Provider name used in error messages, for example "Alpaca". */
  provider: string;
  /** Short path used in error messages (no query string, no secrets). */
  path: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Next data-cache revalidate seconds; ignored when `noStore`. */
  revalidateSeconds?: number;
  noStore?: boolean;
}

/** Parses a Retry-After header (delta-seconds or an HTTP date) into milliseconds, or null. */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, when - nowMs);
  return null;
}

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status: number | null;
  constructor(provider: string, message: string, status: number | null) {
    super(message);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
  }
}

function isTimeoutError(e: unknown): boolean {
  return typeof e === "object" && e !== null && ((e as { name?: string }).name === "TimeoutError" || (e as { name?: string }).name === "AbortError");
}

/** First 160 characters of a response body, whitespace collapsed, so an HTML error page never floods a user-facing message. */
export function shortBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * fetch with a timeout and bounded retry. Returns the Response of the first attempt that is ok, or of the last attempt
 * (so callers can read the status); throws ProviderHttpError on timeout or a network failure after the retries.
 * Never retries 4xx other than 429.
 */
export async function providerFetch(url: string, init: RequestInit, opts: ProviderFetchOptions): Promise<Response> {
  const timeoutMs = timeoutOverrideMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  let attempt = 0;
  for (;;) {
    let res: Response | null = null;
    let failure: ProviderHttpError | null = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const nextInit = opts.noStore ? { cache: "no-store" as const } : opts.revalidateSeconds !== undefined ? { next: { revalidate: opts.revalidateSeconds } } : {};
      // The race guarantees the deadline even if a fetch implementation ignores the abort signal.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const err = new Error("timeout");
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      });
      res = await Promise.race([fetch(url, { ...init, ...nextInit, signal: controller.signal }), deadline]);
    } catch (e) {
      failure = new ProviderHttpError(
        opts.provider,
        isTimeoutError(e)
          ? `${opts.provider} request timed out after ${Math.round(timeoutMs / 1000)} s for ${opts.path}.`
          : `${opts.provider} request failed for ${opts.path}: ${e instanceof Error ? e.message : "network error"}`,
        null
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (res && res.ok) return res;
    const retriable = failure !== null || (res !== null && (res.status === 429 || (res.status >= 500 && res.status <= 599)));
    if (!retriable || attempt >= maxRetries) {
      if (failure) throw failure;
      return res as Response;
    }
    let waitMs = BACKOFF_BASE_MS * 2 ** attempt;
    if (res) {
      const ra = parseRetryAfterMs(res.headers.get("retry-after"));
      if (ra !== null) {
        if (ra > MAX_RETRY_WAIT_MS) return res; // not worth waiting inside a serverless budget: surface the 429/5xx
        waitMs = Math.max(waitMs, ra);
      }
      // drain the body so the connection can be reused
      await res.text().catch(() => "");
    }
    await sleepImpl(waitMs);
    attempt += 1;
  }
}

/** Reads a JSON body, naming the provider in the error instead of a bare SyntaxError. */
export async function readJson<T>(res: Response, provider: string, path: string): Promise<T> {
  let text = "";
  try {
    text = await res.text();
    const parsed = JSON.parse(text) as T;
    if (parsed === null || parsed === undefined) throw new Error("empty JSON body");
    return parsed;
  } catch (e) {
    throw new ProviderHttpError(provider, `${provider} returned an unreadable response for ${path}: ${e instanceof Error ? e.message : "bad JSON"} (${shortBody(text) || "empty body"})`, res.status);
  }
}

/** One call that does fetch + ok check + JSON parse with the provider's name in every error. */
export async function providerJson<T>(url: string, init: RequestInit, opts: ProviderFetchOptions): Promise<T> {
  const res = await providerFetch(url, init, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderHttpError(opts.provider, `${opts.provider} request failed for ${opts.path}: ${res.status} ${shortBody(body)}`, res.status);
  }
  return readJson<T>(res, opts.provider, opts.path);
}

/**
 * Rounds a request window to the cache window so equal requests made a few seconds apart produce an identical URL.
 * start is floored and end is ceiled to a bucket of min(revalidateSeconds, 3600) seconds (at least 5), so the window
 * only ever grows by less than one bucket on each side; end is never moved earlier, so the newest data is kept.
 */
export function snapWindow(startMs: number, endMs: number, revalidateSeconds: number): { startMs: number; endMs: number } {
  const bucketMs = Math.min(Math.max(revalidateSeconds, 5), 3600) * 1000;
  return { startMs: Math.floor(startMs / bucketMs) * bucketMs, endMs: Math.ceil(endMs / bucketMs) * bucketMs };
}

/** True when the number is finite and above zero. */
function pos(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function emptyReport(): FetchReport {
  return { droppedInvalid: 0, droppedDuplicate: 0, truncated: false, warnings: [] };
}

/**
 * Validates candles: a bar needs a finite positive timestamp, finite positive open/high/low/close, a finite
 * non-negative volume and high >= low. Duplicate timestamps keep the first occurrence. Output is sorted ascending.
 * Zero-volume bars are legal and kept (forex tick counts and quiet minutes).
 */
export function cleanCandles(input: MarketCandle[], label: string): { candles: MarketCandle[]; report: FetchReport } {
  const report = emptyReport();
  const seen = new Set<number>();
  const out: MarketCandle[] = [];
  for (const c of input) {
    const ok =
      pos(c.datetime) &&
      pos(c.open) &&
      pos(c.high) &&
      pos(c.low) &&
      pos(c.close) &&
      typeof c.volume === "number" &&
      Number.isFinite(c.volume) &&
      c.volume >= 0 &&
      c.high >= c.low;
    if (!ok) {
      report.droppedInvalid += 1;
      continue;
    }
    if (seen.has(c.datetime)) {
      report.droppedDuplicate += 1;
      continue;
    }
    seen.add(c.datetime);
    out.push(c);
  }
  out.sort((a, b) => a.datetime - b.datetime);
  if (report.droppedInvalid > 0) report.warnings.push(`${label}: dropped ${report.droppedInvalid} invalid bar(s) (missing, non-numeric or non-positive price, or high below low).`);
  if (report.droppedDuplicate > 0) report.warnings.push(`${label}: dropped ${report.droppedDuplicate} duplicate-timestamp bar(s).`);
  return { candles: out, report };
}

/** Logs a report's warnings once on the server so a cleaned or truncated fetch is never fully silent. */
export function logReport(report: FetchReport): void {
  for (const w of report.warnings) console.warn(`[market-data] ${w}`);
}

/** True when `NODE_ENV` is "production": mock data must never be served there. */
export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** Trims and uppercases a ticker for the equity and options providers. */
export function normalizeSymbol(symbol: string): string {
  return String(symbol ?? "").trim().toUpperCase();
}
