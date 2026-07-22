import { NextResponse } from "next/server";
import { getIndicatorSeries } from "@/lib/agents/research-agent/skills/indicator-library";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing required 'id' query param." }, { status: 400 });
  }
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 60;
  try {
    const result = await getIndicatorSeries(id, limit);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
