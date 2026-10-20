import { handleCancelJob } from "@/lib/faye/mailbox/handlers";
import { realDeps } from "@/lib/faye/mailbox/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/jobs/{id}/cancel - the Stop button. FAYE_MAILBOX_CONTRACT.md section 3.4. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleCancelJob(request, id, realDeps());
}
