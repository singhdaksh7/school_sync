import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";

async function requestHostname() {
  const requestHeaders = await headers();
  return hostnameFromHeaders(requestHeaders);
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
            return null;
          }

          const valid = await bcrypt.compare(
            credentials.password as string,
            user.password
          );
          if (!valid) {
            console.error("Login failed: wrong password for email", credentials.email);
            return null;
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
          console.error("Login error:", err);
          return null;
        }
      },
    }),
  ],
});
