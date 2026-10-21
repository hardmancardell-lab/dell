import { handleAdd, handleList } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** GET /api/faye/memory - every note the owner has (proposals, approved, rejected, retired), plus settings and counts. */
export async function GET(request: Request) {
  return handleList(request, realDeps());
}

/** POST /api/faye/memory - add a note the owner typed in About me (saved already approved). */
export async function POST(request: Request) {
  return handleAdd(request, realDeps());
}
