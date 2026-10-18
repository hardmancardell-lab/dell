import { authorizeClient, jsonResponse, loadTargets } from "@/lib/client-research/guard";
import { isResearchableFor, RESEARCH_SYMBOL } from "@/lib/client-research/holdings";
import { getHoldingResearch } from "@/lib/client-research/valuation";

export const maxDuration = 60;

/**
 * GET /api/client/[slug]/research/holding/[symbol]
 * Business phase and phase-matched valuation for ONE stock this client holds. The symbol is not trusted: it must be one
 * of the signed-in client's own stocks (and inside the cap), otherwise the answer is 404, the same as for a stock that
 * exists but belongs to someone else. Results are cached by ticker and rate limited; see lib/client-research.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; symbol: string }> }) {
  const { slug, symbol: rawSymbol } = await params;
  const access = await authorizeClient(request, slug);
  if (!access.ok) return access.response;

  let symbol = "";
  try {
    symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();
  } catch {
    return jsonResponse({ error: "Holding not found." }, 404);
  }
  if (!RESEARCH_SYMBOL.test(symbol)) return jsonResponse({ error: "Holding not found." }, 404);

  let targets;
  try {
    targets = (await loadTargets(access.client)).targets;
  } catch {
    return jsonResponse({ error: "Research is not available right now." }, 503);
  }
  if (!isResearchableFor(targets, symbol)) return jsonResponse({ error: "Holding not found." }, 404);

  return jsonResponse(await getHoldingResearch(symbol), 200);
}
