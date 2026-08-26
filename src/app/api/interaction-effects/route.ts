import { NextResponse } from "next/server";
import { getInteractionEffectMatrix } from "@/lib/agents/trading-agent/skills/interaction-effect-regression";

export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) return NextResponse.json({ error: "Missing required 'symbols' query param (comma-separated)." }, { status: 400 });
  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const result = await getInteractionEffectMatrix(symbols);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
