import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Whether Auth.js would have used secure (`__Secure-`-prefixed) session
 * cookies for this request — mirrors EXACTLY how Auth.js itself decides when
 * *setting* the cookie (see @auth/core's `init.js`:
 * `useSecureCookies = url.protocol === "https:"`, where that URL is built
 * from the `x-forwarded-proto` header when present — see next-auth's
 * `lib/index.js`, which passes `headers.get("x-forwarded-proto")` through
 * for exactly this reason).
 *
 * NODE_ENV is deliberately NOT used as a substitute for transport protocol:
 * ECS always sets NODE_ENV=production regardless of whether the ALB
 * terminates HTTP or HTTPS. Trusting NODE_ENV here (the previous behavior)
 * meant that behind an HTTP-only ALB, Auth.js would set a plain
 * `authjs.session-token` cookie (correctly detecting `x-forwarded-proto:
 * http`), while this function would look for `__Secure-authjs.session-token`
 * (incorrectly assuming NODE_ENV=production implies HTTPS) — the mismatch
 * meant login appeared to succeed but every subsequent request was treated
 * as unauthenticated.
 */
export function isForwardedHttps(req: NextRequest): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    // A load balancer may chain multiple comma-separated values (one per
    // hop) — the first is the client-facing protocol, which is the one
    // Auth.js's own `x-forwarded-proto` read (next-auth lib/index.js) uses
    // too (Headers.get() already returns the first value verbatim, but we
    // still split defensively in case of a multi-value header).
    const first = forwardedProto.split(",")[0]?.trim().toLowerCase();
    if (first) return first === "https";
  }
  // No proxy in front of this request (e.g. local dev) — fall back to
  // whatever protocol Next.js itself observed for the request URL.
  return req.nextUrl.protocol === "https:";
}

const publicRoutes = ["/", "/login", "/founder/login", "/forgot-password", "/reset-password", "/student/login", "/no-school"];

export function isPublicRoute(pathname: string) {
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
    // Teacher mobile routes authenticate via getTeacherAuth() (Bearer JWT OR
    // NextAuth session) — a cookie-only proxy gate has no way to see the
    // Bearer token and would 307-redirect every mobile Teacher request to
    // /login before the route handler ever runs, which a JSON API client
    // reads back as a malformed 200 HTML response. Let these routes through
    // so getTeacherAuth() can do its own dual-mode check and return a clean
    // 401 JSON when unauthenticated instead.
    pathname.startsWith("/api/teacher/") ||
    // Same reasoning as /api/teacher/ above: every /api/student/* route
    // authenticates via getStudentAuth() (Bearer STUDENT JWT OR NextAuth
    // STUDENT session) and returns structured JSON on its own — this is a
    // transport bypass only, not an authorization bypass. Do not add a path
    // here unless it performs its own getStudentAuth()-equivalent check.
    pathname.startsWith("/api/student/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/health"
  );
}

export function isFounderRoute(pathname: string) {
  return (pathname === "/founder" || pathname.startsWith("/founder/")) && pathname !== "/founder/login";
}

export function isFounderApiRoute(pathname: string) {
  return pathname.startsWith("/api/founder/");
}

export function isStudentRoute(pathname: string) {
  return (pathname === "/student" || pathname.startsWith("/student/")) && pathname !== "/student/login";
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
    secureCookie: isForwardedHttps(req),
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

  // Founder API routes already self-check via requireFounderSession(), but
  // gate here too so a non-Founder request never reaches the handler and
  // gets a clean JSON error instead of falling through to the generic
  // HTML /login redirect below.
  if (isFounderApiRoute(pathname)) {
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (token.role !== "FOUNDER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.next();
  }

  // Student routes are gated independently of school-staff auth: only a
  // STUDENT-role token may pass, mirroring the Founder route gate above.
  if (isStudentRoute(pathname)) {
    if (!token || token.role !== "STUDENT") {
      return NextResponse.redirect(new URL("/student/login", req.url));
    }
    return NextResponse.next();
  }

  if (token?.role === "FOUNDER" && (pathname.startsWith("/dashboard") || pathname.startsWith("/teacher"))) {
    return NextResponse.redirect(new URL("/founder/dashboard", req.url));
  }

  if (token?.role === "STUDENT" && (pathname.startsWith("/dashboard") || pathname.startsWith("/teacher"))) {
    return NextResponse.redirect(new URL("/student/dashboard", req.url));
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

  // Surface the current path to server layouts (they can't read it otherwise),
  // so the dashboard layout can exempt the billing page from the suspended-school
  // block without an infinite redirect loop.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|manifest)$).*)",
  ],
};
