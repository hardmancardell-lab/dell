import { NextResponse } from "next/server";
import { DEFAULT_CORRELATION_CANDIDATES, findCorrelations } from "@/lib/agents/trading-agent/skills/correlation-finder";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base");
  const candidatesParam = searchParams.get("candidates");

  if (!base) {
    return NextResponse.json({ error: "Missing required 'base' query param." }, { status: 400 });
  }
  const candidates = candidatesParam
    ? candidatesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : DEFAULT_CORRELATION_CANDIDATES;

  try {
    const result = await findCorrelations(base, candidates);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
