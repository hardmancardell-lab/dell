import { handleEvalRequest, handleRunsList } from "@/lib/faye/lab/handlers";
import { realDeps } from "@/lib/faye/lab/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/lab/eval - test-run results and the tests still waiting or running. */
export async function GET(request: Request) {
  return handleRunsList(request, realDeps());
}

/** POST /api/faye/lab/eval - ask for a test run. Guardrail and orchestration by default; the long suites need confirm_long: true. */
export async function POST(request: Request) {
  return handleEvalRequest(request, realDeps());
}
