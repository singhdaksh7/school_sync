import type { NextAuthConfig } from "next-auth";

type AppUserFields = {
  role?: string | null;
  schoolId?: string | null;
  schoolSlug?: string | null;
  teacherId?: string | null;
  mentorSectionId?: string | null;
};

function appUser(user: unknown): AppUserFields {
  return user as AppUserFields;
}

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = appUser(auth?.user).role;
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
        const schoolSlug = appUser(auth?.user).schoolSlug;
        if (schoolSlug) {
          return new Response(null, { status: 307, headers: { Location: `/dashboard/${schoolSlug}` } });
        }
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = appUser(user).role;
        token.schoolId = appUser(user).schoolId;
        token.schoolSlug = appUser(user).schoolSlug;
        token.teacherId = appUser(user).teacherId;
        token.mentorSectionId = appUser(user).mentorSectionId;
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        Object.assign(session.user, {
          role: token.role,
          schoolId: token.schoolId,
          schoolSlug: token.schoolSlug,
          teacherId: token.teacherId,
          mentorSectionId: token.mentorSectionId,
        });
      }
      return session;
    },
  },
  providers: [], // Providers added in auth.ts (server-only)
};
