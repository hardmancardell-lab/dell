import { NextResponse } from "next/server";

const COOKIE_NAME = "site_access";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const expected = process.env.SITE_ACCESS_PASSWORD;
  if (!expected || !body?.password || body.password !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return res;
}
