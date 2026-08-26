import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { createToken, checkToken } from "@/lib/data/webull";

/** Admin-only — creates a new Webull access token (starts "Pending Verification", needs SMS approval in the Webull App before it's usable). */
export async function POST() {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  try {
    const result = await createToken();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Admin-only — checks a token's verification status after the SMS approval step. */
export async function GET(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const tokenId = searchParams.get("tokenId") ?? undefined;
  try {
    const result = await checkToken(tokenId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
