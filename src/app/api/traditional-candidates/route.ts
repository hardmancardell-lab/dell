import { NextResponse } from "next/server";
import { getTraditionalCandidates } from "@/lib/agents/trading-agent/skills/traditional-portfolio";

// GET, mirrors /api/sector-recommendations — held symbols are passed as a
// lightweight comma-separated query param (just for the "already held" flag),
// not a full holdings POST body, since the rest of this route needs no
// client state.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const heldParam = searchParams.get("held");
    const heldSymbols = heldParam ? heldParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
    const result = await getTraditionalCandidates(heldSymbols);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
