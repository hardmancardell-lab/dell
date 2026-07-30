import { NextResponse } from "next/server";
import { generateEconomicOutlook } from "@/lib/agents/economic-outlook/generate";
import type { RefreshReason } from "@/lib/agents/economic-outlook/types";

const VALID_REASONS: RefreshReason[] = ["scheduled_fomc_cycle", "cpi_print", "nfp_print", "fomc_statement", "ad_hoc_material_change"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const refreshReason = VALID_REASONS.includes(body?.refreshReason) ? (body.refreshReason as RefreshReason) : "ad_hoc_material_change";
  try {
    const outlook = await generateEconomicOutlook(refreshReason);
    return NextResponse.json(outlook);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
