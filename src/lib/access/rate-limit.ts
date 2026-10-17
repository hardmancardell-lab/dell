/**
 * Best-effort, IN-MEMORY, PER-INSTANCE rate limiting.
 *
 * LIMITATION (deliberate, read before relying on it): state lives in this process's memory. On Vercel each warm
 * serverless instance has its own copy and a cold start wipes it, so an attacker spread over instances gets a
 * multiple of the limit. It still blunts casual brute force and bot floods at zero cost. A shared store
 * (Upstash Redis or a Supabase table) is the proper fix and would replace only the Maps below.
 */

export interface RateDecision {
  allowed: boolean;
  /** Seconds the caller should wait before trying again (0 when allowed). */
  retryAfterSec: number;
}

const MAX_KEYS = 5000;

/** Plain sliding window: at most `limit` hits per `windowMs` per key. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  hit(key: string, now = Date.now()): RateDecision {
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    this.sweep(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (this.hits.size <= MAX_KEYS) return;
    for (const [k, arr] of this.hits) {
      if (arr.length === 0 || arr[arr.length - 1] <= now - this.windowMs) this.hits.delete(k);
      if (this.hits.size <= MAX_KEYS * 0.8) break;
    }
  }
}

/**
 * Failed-attempt limiter with escalating lockout, for credential endpoints. `maxFailures` wrong attempts inside
 * `windowMs` lock the key out for `baseLockMs`; each further lockout doubles the delay up to `maxLockMs`.
 * A success clears the key. check() is called before verifying a credential; fail()/succeed() after.
 */
export class LockoutLimiter {
  private state = new Map<string, { failures: number[]; lockedUntil: number; strikes: number }>();
  constructor(
    private maxFailures = 5,
    private windowMs = 15 * 60_000,
    private baseLockMs = 60_000,
    private maxLockMs = 60 * 60_000,
  ) {}

  check(key: string, now = Date.now()): RateDecision {
    const s = this.state.get(key);
    if (s && s.lockedUntil > now) return { allowed: false, retryAfterSec: Math.ceil((s.lockedUntil - now) / 1000) };
    return { allowed: true, retryAfterSec: 0 };
  }

  fail(key: string, now = Date.now()): RateDecision {
    const s = this.state.get(key) ?? { failures: [], lockedUntil: 0, strikes: 0 };
    s.failures = s.failures.filter((t) => t > now - this.windowMs);
    s.failures.push(now);
    if (s.failures.length >= this.maxFailures) {
      const lock = Math.min(this.baseLockMs * 2 ** s.strikes, this.maxLockMs);
      s.lockedUntil = now + lock;
      s.strikes += 1;
      s.failures = [];
    }
    this.state.set(key, s);
    if (this.state.size > MAX_KEYS) {
      for (const [k, v] of this.state) {
        if (v.lockedUntil <= now && v.failures.length === 0 && v.strikes === 0) this.state.delete(k);
        if (this.state.size <= MAX_KEYS * 0.8) break;
      }
    }
    return this.check(key, now);
  }

  succeed(key: string) {
    this.state.delete(key);
  }
}

/** Best-effort client address. Vercel sets x-real-ip / x-vercel-forwarded-for itself; the first x-forwarded-for hop is the fallback. */
export function clientIp(request: Request): string {
  const h = request.headers;
  const raw = h.get("x-real-ip") || h.get("x-vercel-forwarded-for") || (h.get("x-forwarded-for") ?? "").split(",")[0] || "unknown";
  return raw.trim().slice(0, 64) || "unknown";
}

/** Standard 429 JSON response (kept here so every endpoint answers the same way). */
export function tooManyRequests(decision: RateDecision, message = "Too many attempts. Try again later."): Response {
  return new Response(JSON.stringify({ error: message, retryAfterSec: decision.retryAfterSec }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(decision.retryAfterSec) },
  });
}
