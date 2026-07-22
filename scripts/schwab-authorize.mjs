import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

function readEnvVar(envContent, key) {
  const line = envContent.split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.split("=").slice(1).join("=").trim() : null;
}

const envContent = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const appKey = readEnvVar(envContent, "SCHWAB_APP_KEY");
const appSecret = readEnvVar(envContent, "SCHWAB_APP_SECRET");
const redirectUri = readEnvVar(envContent, "SCHWAB_REDIRECT_URI") || "https://127.0.0.1";

if (!appKey || !appSecret) {
  console.error(
    "Missing SCHWAB_APP_KEY / SCHWAB_APP_SECRET in .env.local. Register an app at developer.schwab.com first, then add both keys (and optionally SCHWAB_REDIRECT_URI if your registered callback URL isn't https://127.0.0.1)."
  );
  process.exit(1);
}

const authUrl = `https://api.schwabapi.com/v1/oauth/authorize?client_id=${encodeURIComponent(appKey)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

console.log("\n1. Open this URL in your browser and log into Schwab:\n");
console.log(authUrl);
console.log(
  "\n2. After you approve access, the browser will redirect to your callback URL. That page probably won't load (it's not a real server) — that's fine. Copy the FULL URL from your browser's address bar and paste it below.\n"
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pastedUrl = await rl.question("Paste the full redirect URL here: ");
rl.close();

let code;
try {
  const parsed = new URL(pastedUrl.trim());
  code = parsed.searchParams.get("code");
} catch {
  console.error("That doesn't look like a valid URL. Re-run the script and try again.");
  process.exit(1);
}

if (!code) {
  console.error("No 'code' query param found in the pasted URL. Re-run the script and try again.");
  process.exit(1);
}

const basicAuth = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
const body = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: redirectUri,
});

const res = await fetch("https://api.schwabapi.com/v1/oauth/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${basicAuth}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: body.toString(),
});

if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(`Token exchange failed: ${res.status} ${text}`);
  process.exit(1);
}

const data = await res.json();
const now = Date.now();
const tokens = {
  accessToken: data.access_token,
  accessTokenExpiresAt: now + data.expires_in * 1000,
  refreshToken: data.refresh_token,
  refreshTokenObtainedAt: now,
};

writeFileSync(new URL("../.schwab-tokens.json", import.meta.url), JSON.stringify(tokens, null, 2), "utf-8");

console.log(
  "\nSuccess. Tokens saved to .schwab-tokens.json (gitignored). This refresh token is valid for 7 days — after that, re-run this script.\n"
);
