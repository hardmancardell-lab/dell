import { handleNoteDecision } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/lab/notes/{id} - approve or reject a proposal. Approving only marks it; nothing is written to Faye's corpus here. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleNoteDecision(request, id, realDeps());
}
