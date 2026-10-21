import { handleDeleteAll } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/delete-all - Delete every note and usage count (needs a recent sign-in and confirm DELETE). */
export async function POST(request: Request) {
  return handleDeleteAll(request, realDeps());
}
