import { NextResponse } from "next/server";
import { getGlobalFinancialNews } from "@/lib/agents/trading-agent/skills/global-financial-news";

export async function GET() {
  try {
    const result = await getGlobalFinancialNews();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
