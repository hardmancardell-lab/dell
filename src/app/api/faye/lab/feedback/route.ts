import { handleFeedbackList, handleFeedbackSubmit } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab/feedback - the owner's ratings (a short excerpt and a note each; never the whole chat). */
export async function GET(request: Request) {
  return handleFeedbackList(request, realDeps());
}

/** POST /api/faye/lab/feedback - rate one answer: good, wrong, too_long or off_voice. The server keeps a hash and a 200-character excerpt. */
export async function POST(request: Request) {
  return handleFeedbackSubmit(request, realDeps());
}
