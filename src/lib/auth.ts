import NextAuth, { CredentialsSignin } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { authenticateStudentForMobile } from "@/lib/mobile-auth";
import { statusIsBlocked } from "@/lib/school-access";
import { logAudit } from "@/lib/audit";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  NoAccountError as StudentNoAccountError,
  InvalidPasswordError as StudentInvalidPasswordError,
  AmbiguousSchoolError as StudentAmbiguousSchoolError,
} from "@/lib/auth-errors";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulWebLogin } from "@/lib/auth-login-flow";
import { systemClock } from "@/lib/clock";

async function requestHeaders() {
  return headers();
}

// Distinct `code` values so the login pages can show "no account" vs "wrong
// password" instead of a generic message — surfaced via signIn()'s `code` field.
class NoAccountError extends CredentialsSignin {
  code = "no-account";
}
class InvalidPasswordError extends CredentialsSignin {
  code = "invalid-password";
}
class RateLimitedError extends CredentialsSignin {
  code = "rate-limited";
}
class AmbiguousSchoolError extends CredentialsSignin {
  code = "ambiguous-school";
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

        const hdrs = await requestHeaders();
        const ip = getClientIpFromHeaders(hdrs);
        const email = (credentials.email as string).trim();

        try {
          const limit = await rateLimit(
            `login:${ip ?? "unknown"}:${email.toLowerCase()}`,
            RATE_LIMIT_POLICIES.login
          );
          if (!limit.allowed) throw new RateLimitedError();

          const resolvedSchool = await resolveSchool(hostnameFromHeaders(hdrs));
          const user = await prisma.user.findUnique({
            where: { email },
            include: { ownedSchool: true, school: true },
          });

          if (!user) {
            // No FK to record against, so unknown-email failures are not audited
            // (documented limitation) — only rate-limited above.
            console.error("Login failed: user not found for email", email);
            throw new NoAccountError();
          }

          const now = systemClock.now();
          // Founder accounts have no school scope and are deliberately kept
          // outside this durable lock/quota system (PART: FOUNDER policy).
          const bucketSchoolId = user.role === "FOUNDER" ? null : (user.school?.id ?? user.ownedSchool?.id ?? resolvedSchool?.id ?? null);
          const authFlow = "TEACHER" as const; // shared escalation table for all web staff logins (Owner/Admin/VP/Teacher) — see PART 5 audit note in docs
          const bucketKey = bucketSchoolId ? authBucketKey(bucketSchoolId, authFlow, email) : null;

          if (bucketKey) {
            const lock = await guardAgainstLock(bucketKey, now);
            if (lock.locked) throw new RateLimitedError();
          }

          const valid = await bcrypt.compare(credentials.password as string, user.password);
          if (!valid) {
            await logAudit({
              action: "LOGIN_FAILED",
              entityType: "User",
              entityId: user.id,
              userId: user.id,
              actorRole: user.role,
              ipAddress: ip,
              metadata: { reason: "invalid_password" },
            });
            if (bucketKey && bucketSchoolId) await recordFailedCredential(bucketKey, bucketSchoolId, authFlow, now);
            throw new InvalidPasswordError();
          }

          const auditSuccess = () =>
            logAudit({
              action: "LOGIN_SUCCESS",
              entityType: "User",
              entityId: user.id,
              userId: user.id,
              actorRole: user.role,
              ipAddress: ip,
            });
          const auditBlocked = (reason: string) =>
            logAudit({
              action: "LOGIN_FAILED",
              entityType: "User",
              entityId: user.id,
              userId: user.id,
              actorRole: user.role,
              ipAddress: ip,
              metadata: { reason },
            });

          if (user.role === "FOUNDER") {
            // Founder accounts are platform-level and never tied to a school's
            // hostname/tenant — deliberately skip the tenant cross-check below.
            await auditSuccess();
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
            // Soft-deleted teachers cannot log in at all.
            const teacherProfile = await prisma.teacher.findFirst({
              where: { userId: user.id, isDeleted: false },
              include: { school: { select: { id: true, slug: true, status: true } } },
            });

            if (!teacherProfile) {
              await auditBlocked("teacher_inactive");
              return null;
            }
            if (resolvedSchool && teacherProfile.schoolId !== resolvedSchool.id) {
              console.error("Login failed: teacher account does not belong to this school domain");
              return null;
            }
            if (statusIsBlocked(teacherProfile.school.status)) {
              await auditBlocked("school_blocked");
              return null;
            }

            if (bucketKey) {
              const completion = await completeSuccessfulWebLogin({
                bucketKey,
                actor: { schoolId: teacherProfile.schoolId, actorType: "TEACHER", userId: user.id, teacherId: teacherProfile.id },
                now,
              });
              if (!completion.ok) throw new RateLimitedError();
            }

            await auditSuccess();
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              schoolId: teacherProfile.schoolId,
              schoolSlug: teacherProfile.school.slug,
              teacherId: teacherProfile.id,
              mentorSectionId: teacherProfile.mentorSectionId,
            };
          }

          const school = user.ownedSchool || user.school;

          if (resolvedSchool && school?.id !== resolvedSchool.id) {
            console.error("Login failed: user account does not belong to this school domain");
            return null;
          }
          if (school && statusIsBlocked(school.status)) {
            await auditBlocked("school_blocked");
            return null;
          }

          if (bucketKey && school?.id) {
            const completion = await completeSuccessfulWebLogin({
              bucketKey,
              actor: { schoolId: school.id, actorType: "ADMIN_STAFF", userId: user.id },
              now,
            });
            if (!completion.ok) throw new RateLimitedError();
          }

          await auditSuccess();
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

        const ip = getClientIpFromHeaders(req.headers);
        const identifier = (credentials.identifier as string).trim();
        const schoolSlugHint = (() => {
          const slug = (credentials as Record<string, unknown>).schoolSlug;
          return typeof slug === "string" ? slug : null;
        })();

        try {
          const limit = await rateLimit(
            `student-login:${ip ?? "unknown"}:${identifier.toLowerCase()}`,
            RATE_LIMIT_POLICIES.studentLogin
          );
          if (!limit.allowed) throw new RateLimitedError();

          const now = systemClock.now();
          const resolvedForBucket =
            (await resolveSchool(hostnameFromHeaders(req.headers))) ??
            (schoolSlugHint ? await prisma.school.findUnique({ where: { slug: schoolSlugHint }, select: { id: true } }) : null);
          const bucketKey = resolvedForBucket ? authBucketKey(resolvedForBucket.id, "PARENT_STUDENT", identifier) : null;

          if (bucketKey) {
            const lock = await guardAgainstLock(bucketKey, now);
            if (lock.locked) throw new RateLimitedError();
          }

          let result;
          try {
            result = await authenticateStudentForMobile(identifier, credentials.password as string, req.headers, { slug: schoolSlugHint });
          } catch (err) {
            if (bucketKey && resolvedForBucket && (err instanceof StudentNoAccountError || err instanceof StudentInvalidPasswordError)) {
              await recordFailedCredential(bucketKey, resolvedForBucket.id, "PARENT_STUDENT", now);
            }
            throw err;
          }
          if (!result) return null;

          if (bucketKey) {
            const completion = await completeSuccessfulWebLogin({
              bucketKey,
              actor: { schoolId: result.student.schoolId, actorType: "STUDENT", studentId: result.student.id },
              now,
            });
            if (!completion.ok) throw new RateLimitedError();
          }

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
          if (err instanceof CredentialsSignin) throw err;
          if (err instanceof StudentNoAccountError) throw new NoAccountError();
          if (err instanceof StudentInvalidPasswordError) throw new InvalidPasswordError();
          if (err instanceof StudentAmbiguousSchoolError) throw new AmbiguousSchoolError();
          console.error("Student login error:", err);
          return null;
        }
      },
    }),
  ],
});
