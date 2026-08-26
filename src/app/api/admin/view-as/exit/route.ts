import { NextResponse } from "next/server";
import { ADMIN_VIEW_AS_COOKIE } from "@/lib/admin-view-as";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
