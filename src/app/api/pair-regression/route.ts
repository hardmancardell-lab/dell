import { NextResponse } from "next/server";
import { getPairRegression } from "@/lib/agents/trading-agent/skills/pair-regression";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const x = searchParams.get("x");
  const y = searchParams.get("y");
  if (!x || !y) {
    return NextResponse.json({ error: "Missing required 'x' and 'y' query params." }, { status: 400 });
  }
  try {
    const result = await getPairRegression(x, y);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
