import { authorizeClient, jsonResponse, loadTargets } from "@/lib/client-research/guard";
import { MAX_RESEARCH_HOLDINGS } from "@/lib/client-research/holdings";
import type { ResearchIndex } from "@/lib/client-research/types";

/**
 * GET /api/client/[slug]/research
 * The client's own holdings as the Research section sees them: which stocks can be valued, which cannot and why.
 * No paid or outside call is made here, and no share count, price or cost basis is returned.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await authorizeClient(request, slug);
  if (!access.ok) return access.response;
  try {
    const { targets } = await loadTargets(access.client);
    const body: ResearchIndex = { holdings: targets.refs, cap: MAX_RESEARCH_HOLDINGS, holdsCrypto: targets.holdsCrypto, asOf: new Date().toISOString() };
    return jsonResponse(body, 200);
  } catch {
    return jsonResponse({ error: "Research is not available right now." }, 503);
  }
}
