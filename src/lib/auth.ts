import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";

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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { ownedSchool: true, school: true },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );
        if (!valid) return null;

        if (user.role === "TEACHER") {
          const teacherProfile = await prisma.teacher.findUnique({
            where: { userId: user.id },
            include: { school: { select: { id: true, slug: true } } },
          });
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
      },
    }),
  ],
});
