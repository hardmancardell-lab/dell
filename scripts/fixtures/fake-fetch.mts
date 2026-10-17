// @ts-nocheck
// Shared fake-fetch helpers for the provider tests. No real network call is ever made and no real key is used.
export const calls: { url: string; init: any }[] = [];

const FAKE_ENV = {
  ALPACA_API_KEY_ID: "FAKEKEYID",
  ALPACA_SECRET_KEY: "FAKESECRET",
  TRADIER_ACCESS_TOKEN: "FAKETRADIER",
  OANDA_API_TOKEN: "FAKEOANDA",
  FMP_API_KEY: "FAKEFMP",
  FRED_API_KEY: "FAKEFRED",
  SEC_EDGAR_USER_AGENT: "Fake test@example.com",
};
const ENV_KEYS = [...Object.keys(FAKE_ENV), "MARKET_DATA_MOCK_MODE", "SCHWAB_MOCK_MODE", "MARKET_DATA_PROVIDER", "NODE_ENV", "TRADIER_PRODUCTION_TOKEN"];

/** Resets the provider env to fake values (override with `over`; an undefined value deletes the variable). */
export function setFakeEnv(over: Record<string, string | undefined> = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, FAKE_ENV);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export function install(handler: (url: string, init: any, n: number) => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    calls.push({ url, init });
    return handler(url, init, calls.length);
  }) as typeof fetch;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": typeof body === "string" ? "text/html" : "application/json", ...headers },
  });

/** Never resolves (the abort signal is deliberately NOT honoured, to prove the client enforces its own deadline). */
export const hang = () => new Promise<Response>(() => {});

export const HTML502 = "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center>" + "x".repeat(2000) + "</body></html>";

export function makeT() {
  let bad = 0;
  let pass = 0;
  const t = (name: string, ok: boolean, detail = "") => {
    if (ok) pass++;
    else bad++;
    console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
  };
  const summary = () => {
    console.log(`\n${pass} passed, ${bad} failed`);
    if (bad > 0) process.exit(1);
  };
  return { t, summary };
}

/** Awaits fn; returns {threw, value|error}. */
export async function attempt<T>(fn: () => Promise<T>): Promise<{ threw: false; value: T } | { threw: true; error: any }> {
  try {
    return { threw: false, value: await fn() };
  } catch (error) {
    return { threw: true, error };
  }
}

export const bar = (t: string, o = 100, h = 101, l = 99, c = 100.5, v = 1000) => ({ t, o, h, l, c, v });
