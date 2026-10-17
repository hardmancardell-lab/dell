/**
 * Edge-safe (Web Crypto only) helpers for the app's access cookies and shared-secret checks.
 * Used by src/middleware.ts (Edge runtime) and by Node route handlers alike.
 *
 * Why this exists: the site gate and admin cookies used to hold the raw password/secret, compared with `===`.
 * Now a cookie holds a signed, expiring token `v1.<expiryEpochSeconds>.<hex HMAC-SHA256>`. The HMAC key mixes a
 * server-only key (ACCESS_COOKIE_KEY, falling back to SUPABASE_SERVICE_ROLE_KEY) with the secret itself, so
 *   - a stolen cookie is not the password, and it expires on its own;
 *   - changing the password/secret invalidates every outstanding cookie;
 *   - without the server key the password cannot be recovered from a cookie by offline guessing.
 * Old cookies (raw secret) are simply rejected, so everyone logs in once more after this ships.
 */

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

async function hmac(algo: "SHA-256" | "SHA-1", key: string, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(message));
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  return toHex(await hmac("SHA-256", key, message));
}

export async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const raw = new Uint8Array(await hmac("SHA-1", key, message));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Constant-time string equality. Both inputs are hashed first, so length differences do not leak and the XOR loop
 * always runs over two equal-length digests.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Server-only signing key. Never sent to the browser. May be empty in dev, in which case the secret alone keys the HMAC. */
function serverKey(): string {
  return process.env.ACCESS_COOKIE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

async function sign(label: string, secret: string, exp: number): Promise<string> {
  return hmacSha256Hex(`${serverKey()}\u0000${secret}`, `${label}|${exp}`);
}

/** Issue a token for `label` (for example "site_access", "admin_session", "client:<slug>") valid for ttlSeconds. */
export async function issueAccessToken(label: string, secret: string, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return `v1.${exp}.${await sign(label, secret, exp)}`;
}

/** True only for an unexpired token issued for the same label under the same current secret. Never throws. */
export async function verifyAccessToken(label: string, secret: string | undefined, token: string | undefined | null, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !token) return false;
  const m = /^v1\.(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  return timingSafeEqualStr(await sign(label, secret, exp), m[2]);
}

/** Constant-time check of an Authorization header against `Bearer <secret>`. False when the secret is unset. */
export async function bearerMatches(header: string | null | undefined, secret: string | undefined): Promise<boolean> {
  if (!secret || !header) return false;
  return timingSafeEqualStr(header, `Bearer ${secret}`);
}

export const verifySiteCookie = (value: string | undefined | null) => verifyAccessToken("site_access", process.env.SITE_ACCESS_PASSWORD, value);
export const verifyAdminCookie = (value: string | undefined | null) => verifyAccessToken("admin_session", process.env.ADMIN_ANALYTICS_SECRET, value);
export const issueSiteCookie = (password: string) => issueAccessToken("site_access", password);
export const issueAdminCookie = (secret: string) => issueAccessToken("admin_session", secret);
export const verifyClientCookie = (slug: string, passcodeHash: string, value: string | undefined | null) => verifyAccessToken(`client:${slug}`, passcodeHash, value);
export const issueClientCookie = (slug: string, passcodeHash: string) => issueAccessToken(`client:${slug}`, passcodeHash);
