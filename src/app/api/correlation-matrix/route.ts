import { NextResponse } from "next/server";
import { DEFAULT_MATRIX_UNIVERSE, getCorrelationMatrix } from "@/lib/agents/trading-agent/skills/correlation-matrix";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_MATRIX_UNIVERSE;
  const years = Number(searchParams.get("years") ?? "30");

  try {
    const result = await getCorrelationMatrix(symbols, years);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
