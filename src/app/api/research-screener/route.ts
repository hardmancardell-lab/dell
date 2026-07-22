import { NextResponse } from "next/server";
import { getScreenerCandidates } from "@/lib/agents/research-agent/skills/candidate-screener";

// GET, mirrors /api/sector-recommendations and /api/traditional-candidates —
// watchlisted symbols are a lightweight comma-separated query param (just
// for the "already watchlisted" flag), not a full object POST body.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const watchlistedParam = searchParams.get("watchlisted");
    const watchlisted = watchlistedParam
      ? watchlistedParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    const result = await getScreenerCandidates(watchlisted);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
