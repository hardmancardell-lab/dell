import { handleCorrectionSave, handleCorrectionsList } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab/corrections - "teach me" items. */
export async function GET(request: Request) {
  return handleCorrectionsList(request, realDeps());
}

/** POST /api/faye/lab/corrections - save the owner's better answer to a question. */
export async function POST(request: Request) {
  return handleCorrectionSave(request, realDeps());
}
