import { authorizeClient, jsonResponse, loadTargets } from "@/lib/client-research/guard";
import { getEnvironment } from "@/lib/client-research/environment";

export const maxDuration = 60;

/**
 * GET /api/client/[slug]/research/environment
 * The economic outlook (client-safe fields only), dated catalysts for this client's kinds of holdings, the market-wide
 * crypto read when the client holds crypto, and the outlook scorecard counts. Shared caches, so it costs the same
 * whether one client or a hundred ask.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await authorizeClient(request, slug);
  if (!access.ok) return access.response;
  try {
    const { targets } = await loadTargets(access.client);
    return jsonResponse(await getEnvironment(targets), 200);
  } catch {
    return jsonResponse({ error: "Research is not available right now." }, 503);
  }
}
