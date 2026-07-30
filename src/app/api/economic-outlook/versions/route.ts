import { NextResponse } from "next/server";
import { getOutlookVersionById, listOutlookVersions } from "@/lib/agents/economic-outlook/storage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");
  try {
    if (versionId) {
      const outlook = await getOutlookVersionById(versionId);
      if (!outlook) return NextResponse.json({ error: `No version found for "${versionId}".` }, { status: 404 });
      return NextResponse.json(outlook);
    }
    const versions = await listOutlookVersions();
    return NextResponse.json({ versions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
