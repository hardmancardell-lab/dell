import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_FILE = path.join(process.cwd(), ".schwab-tokens.json");
const TOKEN_ENDPOINT = "https://api.schwabapi.com/v1/oauth/token";
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // hard Schwab platform limit
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry

interface StoredTokens {
  accessToken: string;
  accessTokenExpiresAt: number; // epoch ms
  refreshToken: string;
  refreshTokenObtainedAt: number; // epoch ms
}

function getAppCredentials(): { appKey: string; appSecret: string } {
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error(
      "SCHWAB_APP_KEY / SCHWAB_APP_SECRET are not set. Register an app at developer.schwab.com and add both to .env.local."
    );
  }
  return { appKey, appSecret };
}

async function readTokens(): Promise<StoredTokens> {
  try {
    const raw = await readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as StoredTokens;
  } catch {
    throw new Error(
      "No .schwab-tokens.json found. Run `node scripts/schwab-authorize.mjs` once to complete the one-time login and generate it."
    );
  }
}

async function writeTokens(tokens: StoredTokens): Promise<void> {
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens> {
  const { appKey, appSecret } = getAppCredentials();

  if (Date.now() - tokens.refreshTokenObtainedAt > REFRESH_TOKEN_MAX_AGE_MS) {
    throw new Error(
      "Schwab refresh token has expired (Schwab forces this every 7 days — there's no way to extend it). Run `node scripts/schwab-authorize.mjs` again to re-authorize."
    );
  }

  const basicAuth = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Schwab token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const refreshed: StoredTokens = {
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
    // Schwab issues a new refresh token on each refresh; keep the original
    // 7-day clock anchored to when the user actually logged in, not this
    // refresh, per Schwab's documented behavior of forcing re-auth every 7
    // days regardless of intervening refreshes.
    refreshToken: data.refresh_token,
    refreshTokenObtainedAt: tokens.refreshTokenObtainedAt,
  };

  await writeTokens(refreshed);
  return refreshed;
}

/** Returns a valid access token, refreshing it first if it's near expiry. */
export async function getValidAccessToken(): Promise<string> {
  let tokens = await readTokens();

  if (Date.now() >= tokens.accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    tokens = await refreshAccessToken(tokens);
  }

  return tokens.accessToken;
}
