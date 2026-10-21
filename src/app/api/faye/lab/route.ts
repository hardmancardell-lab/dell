import { handleOverview } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab - counts for the Lab header and whether Faye's worker is online. Owner only; off unless FAYE_LAB_ENABLED. */
export async function GET(request: Request) {
  return handleOverview(request, realDeps());
}
