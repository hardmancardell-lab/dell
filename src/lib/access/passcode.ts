import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Client passcode storage: salted, slow hash (Node's built-in scrypt, no dependency).
 *
 * Stored formats (both live in advisor_clients.passcode_hash):
 *   legacy  64 hex characters: unsalted SHA-256 of the trimmed passcode. Still accepted so no client is locked out.
 *   current "s1$<salt>$<hash>": scrypt (N=16384, r=8, p=1) with a random 16-byte salt and a 16-byte output, both
 *           base64url. 48 characters in all, so it also fits a column sized for the old 64-character hash.
 *           The "s1" tag fixes the parameters; a stronger setting later becomes "s2" and verifies side by side.
 *
 * A legacy hash that verifies is reported with needsRehash so the caller can upgrade it on that same sign-in.
 * Passcodes are never logged or returned from here. Node only (the Edge middleware never sees a passcode).
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 16;
/** Longest passcode hashed; longer input is refused up front so the slow hash cannot be used to burn CPU. */
export const MAX_PASSCODE_LENGTH = 256;

const LEGACY = /^[0-9a-f]{64}$/;
const CURRENT = /^s1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{22})$/;

function derive(passcode: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passcode.trim().normalize("NFKC"), salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** True for a hash in the old unsalted format. */
export function isLegacyPasscodeHash(stored: string): boolean {
  return LEGACY.test(stored);
}

/** The legacy hash, kept only so old rows can be verified (and by tests that build old rows). Never use it to store. */
export function legacySha256Passcode(passcode: string): string {
  return createHash("sha256").update(passcode.trim()).digest("hex");
}

export async function hashPasscodeSalted(passcode: string): Promise<string> {
  if (typeof passcode !== "string" || !passcode.trim() || passcode.length > MAX_PASSCODE_LENGTH) throw new Error("Invalid passcode.");
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(passcode, salt);
  return `s1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// A real-looking current-format hash of a random value, so an unknown slug costs the same CPU as a known one.
let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  return (dummy ??= hashPasscodeSalted(randomBytes(12).toString("hex")));
}

export interface PasscodeCheck {
  ok: boolean;
  /** True when the passcode matched a legacy hash: store a salted one now. */
  needsRehash: boolean;
}

/** Never throws. `stored` may be null (unknown client): a check against a dummy hash runs so timing does not reveal it. */
export async function verifyPasscode(passcode: string, stored: string | null): Promise<PasscodeCheck> {
  const no: PasscodeCheck = { ok: false, needsRehash: false };
  try {
    if (typeof passcode !== "string" || !passcode.trim() || passcode.length > MAX_PASSCODE_LENGTH) return no;
    if (stored === null) {
      const d = CURRENT.exec(await dummyHash());
      if (d) await derive(passcode, Buffer.from(d[1], "base64url"));
      return no;
    }
    const cur = CURRENT.exec(stored);
    if (cur) {
      const want = Buffer.from(cur[2], "base64url");
      const got = await derive(passcode, Buffer.from(cur[1], "base64url"));
      return { ok: want.length === got.length && timingSafeEqual(want, got), needsRehash: false };
    }
    if (LEGACY.test(stored)) {
      const want = Buffer.from(stored, "hex");
      const got = Buffer.from(legacySha256Passcode(passcode), "hex");
      const ok = timingSafeEqual(want, got);
      return { ok, needsRehash: ok };
    }
    return no;
  } catch {
    return no;
  }
}
