import { handleStatus } from "@/lib/faye/mailbox/handlers";
import { realDeps } from "@/lib/faye/mailbox/deps";

export const dynamic = "force-dynamic";

/** GET /api/faye/status[?wake=1] - is Faye reachable for this signed-in user? See FAYE_MAILBOX_CONTRACT.md section 3.1. */
export async function GET(request: Request) {
  return handleStatus(request, realDeps());
}
