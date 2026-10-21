import { handleNoteCreate, handleNotesList } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab/notes[?status=] - notes proposed for Faye's corpus. */
export async function GET(request: Request) {
  return handleNotesList(request, realDeps());
}

/** POST /api/faye/lab/notes - propose a note (pending). Never from a held-out exam question. */
export async function POST(request: Request) {
  return handleNoteCreate(request, realDeps());
}
