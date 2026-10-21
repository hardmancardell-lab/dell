import { handleErase } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/erase - Erase everything Faye holds about the person (needs a recent sign-in and confirm DELETE). */
export async function POST(request: Request) {
  return handleErase(request, realDeps());
}
