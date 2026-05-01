import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreRedirect(req: Request, path: string) {
  return NextResponse.redirect(new URL(path, req.url), {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return noStoreRedirect(req, "/login");

  const user = session.user as { role?: string; schoolSlug?: string };
  if (user.role === "TEACHER") return noStoreRedirect(req, "/teacher/attendance");

  if (user.schoolSlug) return noStoreRedirect(req, `/dashboard/${user.schoolSlug}`);
  return noStoreRedirect(req, "/onboarding");
}
