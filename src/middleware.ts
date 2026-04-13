import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  const publicRoutes = ["/", "/login", "/register"];
  const isPublic = publicRoutes.includes(pathname) || pathname.startsWith("/invite/");

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && (pathname === "/login" || pathname === "/register")) {
    const schoolSlug = (req.auth?.user as any)?.schoolSlug;
    if (schoolSlug) {
      return NextResponse.redirect(new URL(`/dashboard/${schoolSlug}`, req.url));
    }
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
