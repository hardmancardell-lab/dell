import { handleDecision } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/{id}/decision - approve or reject a proposal; retire, revive or undelete a note. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDecision(request, id, realDeps());
}
