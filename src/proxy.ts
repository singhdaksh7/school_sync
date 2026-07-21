import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import jwt from "jsonwebtoken";

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

const publicRoutes = ["/", "/login", "/founder/login", "/forgot-password", "/reset-password", "/student/login", "/guardian/login", "/no-school"];

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
    pathname === "/api/health" ||
    // Audited (2026-07-15): every route under /api/internal/ — worker,
    // maintenance/file-retention, maintenance/school-purge, and the three
    // Vercel-Cron wrappers under internal/cron/* — confirmed to be the
    // complete set via `find`/`glob` over src/app/api/internal/**/route.ts.
    // Each independently authenticates before doing anything: the
    // POST routes via a timing-safe comparison against JOB_WORKER_SECRET
    // (`x-worker-secret` header, see each route's own `authorized()`), the
    // GET cron routes via a timing-safe comparison against CRON_SECRET
    // (`Authorization: Bearer` header, see src/lib/cron-auth.ts) — never a
    // NextAuth session cookie either way. Same reasoning as /api/teacher/
    // and /api/student/ above: without this, the cookie-only proxy gate
    // 307-redirects every internal caller (the standalone worker poller, a
    // scheduler, Vercel Cron) to /login, which a JSON client reads back as
    // an unparseable 200 HTML page instead of the clean 401 the route
    // itself would return. Do not add a path here unless it performs its
    // own non-cookie auth check first.
    pathname.startsWith("/api/internal/")
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

export function isGuardianRoute(pathname: string) {
  return (pathname === "/guardian" || pathname.startsWith("/guardian/")) && pathname !== "/guardian/login";
}

/**
 * Guardian sessions are NOT a NextAuth token (see src/lib/parent-auth.ts) —
 * they're a separate signed JWT in the `guardian_session` httpOnly cookie,
 * issued by /api/parent/login. getToken() above only understands NextAuth's
 * own cookie, so the Founder/Student pattern of checking `token.role` can't
 * apply here; this verifies the guardian JWT's signature/expiry directly
 * (mirroring verifyParentToken in src/lib/parent-auth.ts exactly, including
 * its NEXTAUTH_SECRET-only secret resolution — no AUTH_SECRET fallback,
 * since that's what signed it) rather than only checking cookie presence,
 * matching the same verified-not-just-present depth as the Founder/Student
 * gates above.
 */
function hasValidGuardianSession(req: NextRequest): boolean {
  const token = req.cookies.get("guardian_session")?.value;
  if (!token) return false;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  try {
    const decoded = jwt.verify(token, secret) as { role?: string };
    return decoded.role === "PARENT";
  } catch {
    return false;
  }
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

  // Guardian routes are gated independently too, same shape as Founder/
  // Student above, but against the separate guardian_session JWT instead of
  // a NextAuth token — see hasValidGuardianSession.
  if (isGuardianRoute(pathname)) {
    if (!hasValidGuardianSession(req)) {
      return NextResponse.redirect(new URL("/guardian/login", req.url));
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
