import { NextResponse } from "next/server";
import { getBondMacroSnapshot } from "@/lib/agents/trading-agent/skills/bond-macro";

export async function GET() {
  try {
    const snapshot = await getBondMacroSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
