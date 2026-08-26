import { NextResponse } from "next/server";
import { fetchQuote, isWebullConfigured } from "@/lib/data/webull";

/** Verification-only route — hit this once real WEBULL_APP_KEY/SECRET are set to confirm the signing algorithm and snapshot endpoint actually work against Webull's live API. */
export async function GET(request: Request) {
  if (!isWebullConfigured()) {
    return NextResponse.json({ error: "WEBULL_APP_KEY/WEBULL_APP_SECRET are not configured." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "AAPL";
  try {
    const quote = await fetchQuote(symbol);
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
