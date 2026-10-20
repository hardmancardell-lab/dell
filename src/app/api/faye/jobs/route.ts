import { handleCreateJob } from "@/lib/faye/mailbox/handlers";
import { realDeps } from "@/lib/faye/mailbox/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/jobs - queue a chat or continue job in the Faye mailbox. See FAYE_MAILBOX_CONTRACT.md section 3.2. */
export async function POST(request: Request) {
  return handleCreateJob(request, realDeps());
}
