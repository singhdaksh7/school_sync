import NextAuth, { CredentialsSignin } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { authenticateStudentForMobile } from "@/lib/mobile-auth";
import { NoAccountError as StudentNoAccountError, InvalidPasswordError as StudentInvalidPasswordError } from "@/lib/auth-errors";

async function requestHostname() {
  const requestHeaders = await headers();
  return hostnameFromHeaders(requestHeaders);
}

// Distinct `code` values so the login pages can show "no account" vs "wrong
// password" instead of a generic message — surfaced via signIn()'s `code` field.
class NoAccountError extends CredentialsSignin {
  code = "no-account";
}
class InvalidPasswordError extends CredentialsSignin {
  code = "invalid-password";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const resolvedSchool = await resolveSchool(await requestHostname());
          const user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
            include: { ownedSchool: true, school: true },
          });

          if (!user) {
            console.error("Login failed: user not found for email", credentials.email);
            throw new NoAccountError();
          }

          const valid = await bcrypt.compare(
            credentials.password as string,
            user.password
          );
          if (!valid) {
            console.error("Login failed: wrong password for email", credentials.email);
            throw new InvalidPasswordError();
          }

          if (user.role === "FOUNDER") {
            // Founder accounts are platform-level and never tied to a school's
            // hostname/tenant — deliberately skip the tenant cross-check below.
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              schoolId: null,
              schoolSlug: null,
              teacherId: null,
              mentorSectionId: null,
            };
          }

          if (user.role === "TEACHER") {
            const teacherProfile = await prisma.teacher.findUnique({
              where: { userId: user.id },
              include: { school: { select: { id: true, slug: true } } },
            });

            if (resolvedSchool && teacherProfile?.schoolId !== resolvedSchool.id) {
              console.error("Login failed: teacher account does not belong to this school domain");
              return null;
            }

            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              schoolId: teacherProfile?.schoolId ?? null,
              schoolSlug: teacherProfile?.school?.slug ?? null,
              teacherId: teacherProfile?.id ?? null,
              mentorSectionId: teacherProfile?.mentorSectionId ?? null,
            };
          }

          const school = user.ownedSchool || user.school;

          if (resolvedSchool && school?.id !== resolvedSchool.id) {
            console.error("Login failed: user account does not belong to this school domain");
            return null;
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            schoolId: school?.id ?? null,
            schoolSlug: school?.slug ?? null,
            teacherId: null,
            mentorSectionId: null,
          };
        } catch (err) {
          if (err instanceof CredentialsSignin) throw err;
          console.error("Login error:", err);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: "student-credentials",
      name: "student-credentials",
      credentials: {
        identifier: { label: "Admission Number or Student ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.identifier || !credentials?.password) return null;

        try {
          const result = await authenticateStudentForMobile(
            credentials.identifier as string,
            credentials.password as string,
            req.headers
          );
          if (!result) return null;

          return {
            id: result.student.id,
            name: result.student.name,
            email: result.student.email,
            role: "STUDENT",
            schoolId: result.student.schoolId,
            schoolSlug: result.school.slug,
            teacherId: null,
            mentorSectionId: null,
            studentId: result.student.id,
            sectionId: result.student.sectionId,
          };
        } catch (err) {
          if (err instanceof StudentNoAccountError) throw new NoAccountError();
          if (err instanceof StudentInvalidPasswordError) throw new InvalidPasswordError();
          console.error("Student login error:", err);
          return null;
        }
      },
    }),
  ],
});
