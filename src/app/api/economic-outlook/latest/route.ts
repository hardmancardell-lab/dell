import { NextResponse } from "next/server";
import { getLatestOutlookVersion, isEconomicOutlookDbConfigured } from "@/lib/agents/economic-outlook/storage";

export async function GET() {
  if (!isEconomicOutlookDbConfigured()) {
    return NextResponse.json({ error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured." }, { status: 500 });
  }
  try {
    const outlook = await getLatestOutlookVersion();
    if (!outlook) {
      return NextResponse.json({ error: "No Economic Outlook version exists yet — run a refresh first." }, { status: 404 });
    }
    return NextResponse.json(outlook);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
