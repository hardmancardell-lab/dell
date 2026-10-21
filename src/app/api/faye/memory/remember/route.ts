import { handleRemember } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** POST /api/faye/memory/remember - Run the owner's typed message through the remember/forget commands and the safe extractors. */
export async function POST(request: Request) {
  return handleRemember(request, realDeps());
}
