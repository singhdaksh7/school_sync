import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const publicRoutes = ["/", "/login", "/register"];

function isPublicRoute(pathname: string) {
  return (
    publicRoutes.includes(pathname) ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/teacher-invite/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/invite/") ||
    pathname.startsWith("/api/teacher-invite/") ||
    pathname.startsWith("/api/parent/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/health"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

  if (!secret) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const token = await getToken({ req, secret });

  if (!token && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token?.role === "TEACHER" && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/teacher/attendance", req.url));
  }

  const isTeacherPage =
    pathname.startsWith("/teacher/attendance") ||
    pathname.startsWith("/teacher/marks") ||
    pathname.startsWith("/teacher/timetable");

  if (token && token.role !== "TEACHER" && isTeacherPage) {
    const schoolSlug = typeof token.schoolSlug === "string" ? token.schoolSlug : "";
    if (schoolSlug) return NextResponse.redirect(new URL(`/dashboard/${schoolSlug}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|manifest)$).*)",
  ],
};
