import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const publicRoutes = ["/", "/login", "/register", "/founder/login"];

function isPublicRoute(pathname: string) {
  return (
    publicRoutes.includes(pathname) ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/teacher-invite/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/branding" ||
    pathname.startsWith("/api/invite/") ||
    pathname.startsWith("/api/teacher-invite/") ||
    pathname.startsWith("/api/parent/") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/health"
  );
}

function isFounderRoute(pathname: string) {
  return (pathname === "/founder" || pathname.startsWith("/founder/")) && pathname !== "/founder/login";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

  if (!secret) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const token = await getToken({
    req,
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  });

  // Founder routes are gated independently of school-scoped auth: only a
  // FOUNDER-role token may pass, and non-public founder paths never fall
  // through to the generic /login redirect below.
  if (isFounderRoute(pathname)) {
    if (!token || token.role !== "FOUNDER") {
      return NextResponse.redirect(new URL("/founder/login", req.url));
    }
    return NextResponse.next();
  }

  if (token?.role === "FOUNDER" && (pathname.startsWith("/dashboard") || pathname.startsWith("/teacher"))) {
    return NextResponse.redirect(new URL("/founder/dashboard", req.url));
  }

  if (!token && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token?.role === "TEACHER" && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/teacher/attendance", req.url));
  }

  const isTeacherPage =
    pathname.startsWith("/teacher/attendance") ||
    pathname.startsWith("/teacher/marks") ||
    pathname.startsWith("/teacher/timetable") ||
    pathname.startsWith("/teacher/arrangements") ||
    pathname.startsWith("/teacher/early-leave");

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
