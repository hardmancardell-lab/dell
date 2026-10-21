import { handleExport } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/export - Download everything the memory holds as JSON (needs a recent sign-in). */
export async function POST(request: Request) {
  return handleExport(request, realDeps());
}
