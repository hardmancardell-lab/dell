import { NextResponse } from "next/server";
import { getYieldCurve } from "@/lib/agents/trading-agent/skills/yield-curve";

export async function GET() {
  try {
    const result = await getYieldCurve();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
