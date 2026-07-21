import { NextResponse } from "next/server";
import { GUARDIAN_COOKIE_NAME } from "@/lib/parent-auth";

/** Clears the Guardian web portal's httpOnly session cookie (PART 1). No auth check needed — clearing an already-absent or already-invalid cookie is harmless. */
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(GUARDIAN_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
