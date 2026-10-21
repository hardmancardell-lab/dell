import { handleSettings } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/settings - Pause or resume learning; show or hide the used-notes line. */
export async function POST(request: Request) {
  return handleSettings(request, realDeps());
}
