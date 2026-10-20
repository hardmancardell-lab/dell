import { handlePollJob } from "@/lib/faye/mailbox/handlers";
import { realDeps } from "@/lib/faye/mailbox/deps";

export const dynamic = "force-dynamic";
/** The long poll holds a request up to 12 s (default 8 s); leave headroom for the database calls around it. */
export const maxDuration = 25;

/** GET /api/faye/jobs/{id}?after={seq}&wait={ms} - long poll for new events or the final result. FAYE_MAILBOX_CONTRACT.md section 3.3. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePollJob(request, id, realDeps());
}
