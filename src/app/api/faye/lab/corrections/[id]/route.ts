import { handleCorrectionAction } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/lab/corrections/{id} - dismiss, reopen, or promote to ONE set: a training question or a held-out exam question. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleCorrectionAction(request, id, realDeps());
}
