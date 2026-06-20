import type { NextAuthConfig } from "next-auth";

type AppUserFields = {
  role?: string | null;
  schoolId?: string | null;
  schoolSlug?: string | null;
  teacherId?: string | null;
  mentorSectionId?: string | null;
  studentId?: string | null;
  sectionId?: string | null;
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

      const publicRoutes = ["/", "/login", "/register", "/founder/login", "/forgot-password", "/reset-password", "/student/login"];
      const isPublic =
        publicRoutes.includes(pathname) ||
        pathname.startsWith("/invite/") ||
        pathname.startsWith("/teacher-invite/") ||
        pathname.startsWith("/api/auth/") ||
        pathname.startsWith("/api/invite/") ||
        pathname.startsWith("/api/teacher-invite/") ||
        pathname === "/api/health";

      const isFounderRoute = (pathname === "/founder" || pathname.startsWith("/founder/")) && pathname !== "/founder/login";

      // Founder routes are gated independently of school-scoped auth.
      if (isFounderRoute) {
        if (!isLoggedIn || role !== "FOUNDER") {
          return new Response(null, { status: 307, headers: { Location: "/founder/login" } });
        }
        return true;
      }

      if (!isLoggedIn && !isPublic) return false;

      // FOUNDER and STUDENT roles: never allowed into school-staff-scoped areas
      if (isLoggedIn && (role === "FOUNDER" || role === "STUDENT") && (pathname.startsWith("/dashboard") || pathname.startsWith("/teacher"))) {
        const dest = role === "FOUNDER" ? "/founder/dashboard" : "/student/dashboard";
        return new Response(null, { status: 307, headers: { Location: dest } });
      }

      // TEACHER role: block dashboard access, allow teacher pages
      if (isLoggedIn && role === "TEACHER" && pathname.startsWith("/dashboard")) {
        return new Response(null, { status: 307, headers: { Location: "/teacher/attendance" } });
      }

      // Non-teachers: block teacher portal pages
      if (isLoggedIn && role !== "TEACHER" && (pathname === "/teacher" || pathname.startsWith("/teacher/"))) {
        const schoolSlug = appUser(auth?.user).schoolSlug;
        if (schoolSlug) {
          return new Response(null, { status: 307, headers: { Location: `/dashboard/${schoolSlug}` } });
        }
      }

      // Student routes are gated independently: only a STUDENT-role token may pass.
      const isStudentRoute = (pathname === "/student" || pathname.startsWith("/student/")) && pathname !== "/student/login";
      if (isStudentRoute) {
        if (!isLoggedIn || role !== "STUDENT") {
          return new Response(null, { status: 307, headers: { Location: "/student/login" } });
        }
        return true;
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
        token.studentId = appUser(user).studentId;
        token.sectionId = appUser(user).sectionId;
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
          studentId: token.studentId,
          sectionId: token.sectionId,
        });
      }
      return session;
    },
  },
  providers: [], // Providers added in auth.ts (server-only)
};
