import { NextResponse } from "next/server";
import { getSectorFundamentals } from "@/lib/agents/research-agent/skills/sector-fundamentals";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sector = searchParams.get("sector");
  if (!sector) {
    return NextResponse.json({ error: "Missing required 'sector' query param." }, { status: 400 });
  }
  try {
    const fundamentals = await getSectorFundamentals(sector);
    return NextResponse.json(fundamentals);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
