import { authorizeClient, jsonResponse } from "@/lib/client-research/guard";
import { buildMethodExplainer } from "@/lib/client-research/method";

/** GET /api/client/[slug]/research/method: "How we value things". Static text built from the tools' own constants. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await authorizeClient(request, slug);
  if (!access.ok) return access.response;
  return jsonResponse(buildMethodExplainer(), 200, { "cache-control": "private, max-age=3600" });
}
