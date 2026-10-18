import { isValidId } from "@/lib/data/postgrest-safe";
import { getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { verifyClientCookie } from "@/lib/access/tokens";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import type { AdvisorClient, PortfolioHolding } from "@/lib/agents/trading-agent/types";
import { researchTargets } from "./holdings";
import type { ResearchTargets } from "./holdings";

/**
 * Access check shared by every route under /api/client/[slug]/research. It is the same pattern as
 * /api/client/[slug]/dashboard (slug shape, client lookup, signed cookie bound to the slug and the stored passcode hash)
 * plus two rate limits. The middleware does NOT protect /api/client, so nothing here may be skipped.
 *
 * Order matters:
 *   1. kill switch (CLIENT_RESEARCH_ENABLED=false turns the whole section off without a deploy);
 *   2. slug shape, 404 (no database call for junk);
 *   3. per-address limit BEFORE the database lookup, so a flood of guessed slugs cannot hammer the database;
 *   4. client lookup, 404;
 *   5. cookie check, 401. A cookie issued for another client's slug, or for this slug before a passcode change, fails;
 *   6. per-client limit, 429.
 * The research never takes a ticker from the visitor: callers get the client's own holdings from `loadTargets`.
 */

// Best-effort and per instance, like every limiter in rate-limit.ts. The hard cost guard is the hourly fetch budget in cache.ts.
const perIp = new SlidingWindowLimiter(90, 10 * 60_000);
const perClient = new SlidingWindowLimiter(120, 10 * 60_000);

export function clientResearchEnabled(): boolean {
  return (process.env.CLIENT_RESEARCH_ENABLED ?? "true").toLowerCase() !== "false";
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store", ...extra } });
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export type ClientAccess = { ok: true; client: AdvisorClient & { passcodeHash: string } } | { ok: false; response: Response };

export async function authorizeClient(request: Request, slug: string): Promise<ClientAccess> {
  if (!clientResearchEnabled()) return { ok: false, response: jsonResponse({ error: "Research is switched off right now." }, 503) };
  if (!isValidId(slug)) return { ok: false, response: jsonResponse({ error: "Client not found." }, 404) };

  const ip = clientIp(request);
  const gate = perIp.hit(ip);
  if (!gate.allowed) return { ok: false, response: tooManyRequests(gate, "Too many requests. Try again in a few minutes.") };

  let client: (AdvisorClient & { passcodeHash: string }) | null;
  try {
    client = await getAdvisorClientBySlug(slug);
  } catch {
    return { ok: false, response: jsonResponse({ error: "Research is not available right now." }, 503) };
  }
  if (!client) return { ok: false, response: jsonResponse({ error: "Client not found." }, 404) };

  const session = readCookie(request, `client_session_${slug}`);
  if (!(await verifyClientCookie(slug, client.passcodeHash, session))) {
    return { ok: false, response: jsonResponse({ error: "Passcode required.", requiresPasscode: true }, 401) };
  }

  const own = perClient.hit(slug);
  if (!own.allowed) return { ok: false, response: tooManyRequests(own, "Too many requests. Try again in a few minutes.") };
  return { ok: true, client };
}

/** The client's own holdings, reduced to what the research may look at. Throws only on a database failure. */
export async function loadTargets(client: AdvisorClient): Promise<{ holdings: PortfolioHolding[]; targets: ResearchTargets }> {
  const holdings = await listClientHoldings(client.id);
  return { holdings, targets: researchTargets(holdings) };
}

export { jsonResponse };
