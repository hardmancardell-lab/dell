import { handleExamsList } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab/exams - training questions and held-out exam questions, in separate lists. */
export async function GET(request: Request) {
  return handleExamsList(request, realDeps());
}
