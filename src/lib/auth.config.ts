import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = (auth?.user as any)?.role;
      const pathname = nextUrl.pathname;

      const publicRoutes = ["/", "/login", "/register"];
      const isPublic =
        publicRoutes.includes(pathname) ||
        pathname.startsWith("/invite/") ||
        pathname.startsWith("/teacher-invite/") ||
        pathname.startsWith("/api/auth/") ||
        pathname.startsWith("/api/invite/") ||
        pathname.startsWith("/api/teacher-invite/") ||
        pathname === "/api/health";

      if (!isLoggedIn && !isPublic) return false;

      // TEACHER role: block dashboard access, allow teacher pages
      if (isLoggedIn && role === "TEACHER" && pathname.startsWith("/dashboard")) {
        return new Response(null, { status: 307, headers: { Location: "/teacher/attendance" } });
      }

      // Non-teachers: block teacher portal pages
      if (isLoggedIn && role !== "TEACHER" && (pathname.startsWith("/teacher/attendance") || pathname.startsWith("/teacher/marks") || pathname.startsWith("/teacher/timetable"))) {
        const schoolSlug = (auth?.user as any)?.schoolSlug;
        if (schoolSlug) {
          return new Response(null, { status: 307, headers: { Location: `/dashboard/${schoolSlug}` } });
        }
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.schoolId = (user as any).schoolId;
        token.schoolSlug = (user as any).schoolSlug;
        token.teacherId = (user as any).teacherId;
        token.mentorSectionId = (user as any).mentorSectionId;
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
        (session.user as any).schoolId = token.schoolId;
        (session.user as any).schoolSlug = token.schoolSlug;
        (session.user as any).teacherId = token.teacherId;
        (session.user as any).mentorSectionId = token.mentorSectionId;
      }
      return session;
    },
  },
  providers: [], // Providers added in auth.ts (server-only)
};
