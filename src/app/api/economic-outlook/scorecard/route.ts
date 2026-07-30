import { NextResponse } from "next/server";
import { appendScorecardEntry, getOutlookVersionById, gradeScorecardEntry, listScorecardEntries } from "@/lib/agents/economic-outlook/storage";
import type { ScorecardEntry } from "@/lib/agents/economic-outlook/types";

export async function GET() {
  try {
    const entries = await listScorecardEntries();
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Logs a new call (from an existing outlook version) into the scorecard — ungraded until the follow-up PATCH. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.versionId) {
    return NextResponse.json({ error: "Body must include { versionId }." }, { status: 400 });
  }
  try {
    const outlook = await getOutlookVersionById(body.versionId);
    if (!outlook) return NextResponse.json({ error: `No outlook version found for "${body.versionId}".` }, { status: 404 });

    const entry: ScorecardEntry = {
      versionId: outlook.meta.versionId,
      loggedDate: new Date().toISOString().slice(0, 10),
      regimeTagAtCall: outlook.regimeTag.label,
      houseViewPathAtCall: outlook.policyStance.houseViewPath,
      keyFalsificationTriggers: outlook.selfQa.map((q) => q.falsificationTrigger),
      grading: {
        gradedDate: null,
        didTriggersFire: null,
        actualFedAction: null,
        actualMarketReaction: null,
        wasRegimeTagCorrect: null,
        wasHouseViewPathCorrect: null,
        notesOnWhatBrokeOrHeld: null,
        lessonForNextVersion: null,
      },
    };
    await appendScorecardEntry(entry);
    return NextResponse.json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Grades an already-logged entry, 6-8 weeks later once outcome data exists. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.versionId || !body?.grading) {
    return NextResponse.json({ error: "Body must include { versionId, grading }." }, { status: 400 });
  }
  try {
    await gradeScorecardEntry(body.versionId, { ...body.grading, gradedDate: body.grading.gradedDate ?? new Date().toISOString().slice(0, 10) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
