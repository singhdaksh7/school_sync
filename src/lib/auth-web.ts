/**
 * Web (NextAuth) credential resolution for staff and Founder accounts.
 *
 * Mirrors the split already used by src/lib/mobile-auth.ts
 * (authenticateStaffForMobile / authenticateStudentForMobile): identity,
 * password, and tenant/status checks live here as plain functions that throw
 * the shared src/lib/auth-errors.ts classes; src/lib/auth.ts's NextAuth
 * `authorize()` callbacks are thin wrappers that catch those and rethrow as
 * NextAuth's own CredentialsSignin subclasses.
 *
 * SECURITY: role is never an input to either function below — it is looked
 * up from the database by email and compared against an explicit allowlist
 * (authenticateStaffForWeb) or an exact match (authenticateFounderForWeb).
 * A credential that resolves to the wrong account type is rejected with the
 * same NoAccountError used for a truly unknown email, after paying the same
 * bcrypt cost as a real account, so a caller cannot use response timing to
 * learn "this email exists but is Founder-only" (or vice versa).
 */
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { statusIsBlocked } from "@/lib/school-access";
import { logAudit } from "@/lib/audit";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { NoAccountError, InvalidPasswordError, RateLimitedError } from "@/lib/auth-errors";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulWebLogin } from "@/lib/auth-login-flow";
import { STAFF_ROLES } from "@/lib/auth-roles";
import { systemClock } from "@/lib/clock";

export type WebLoginResult = {
  id: string;
  name: string;
  email: string;
  role: string;
  schoolId: string | null;
  schoolSlug: string | null;
  teacherId: string | null;
  mentorSectionId: string | null;
};

/**
 * Owner / Admin / Vice Principal / Teacher web login. FOUNDER (and any other
 * non-staff role) is rejected as NoAccountError — never surfaced as a
 * distinct error — so a Founder credential cannot authenticate through the
 * general school login page.
 */
export async function authenticateStaffForWeb(email: string, password: string, headers: Headers): Promise<WebLoginResult | null> {
  const ip = getClientIpFromHeaders(headers);
  const normalizedEmail = email.trim();

  const limit = await rateLimit(`login:${ip ?? "unknown"}:${normalizedEmail.toLowerCase()}`, RATE_LIMIT_POLICIES.login);
  if (!limit.allowed) throw new RateLimitedError();

  const resolvedSchool = await resolveSchool(hostnameFromHeaders(headers));
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { ownedSchool: true, school: true },
  });

  if (!user) {
    // No FK to record against, so unknown-email failures are not audited
    // (documented limitation) — only rate-limited above.
    console.error("Login failed: user not found for email", normalizedEmail);
    throw new NoAccountError();
  }

  const now = systemClock.now();
  const bucketSchoolId = user.school?.id ?? user.ownedSchool?.id ?? resolvedSchool?.id ?? null;
  const authFlow = "TEACHER" as const; // shared escalation table for all web staff logins (Owner/Admin/VP/Teacher)
  const bucketKey = bucketSchoolId ? authBucketKey(bucketSchoolId, authFlow, normalizedEmail) : null;

  if (bucketKey) {
    const lock = await guardAgainstLock(bucketKey, now);
    if (lock.locked) throw new RateLimitedError();
  }

  const valid = await bcrypt.compare(password, user.password);
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

  // Password is correct, but this login surface is staff-only: a Founder (or
  // any role outside STAFF_ROLES) never authenticates here, and we don't
  // reveal that the account exists at all.
  if (!STAFF_ROLES.has(user.role)) {
    await logAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      userId: user.id,
      actorRole: user.role,
      ipAddress: ip,
      metadata: { reason: "role_not_staff" },
    });
    throw new NoAccountError();
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
}

/**
 * Founder-only web login. Any account whose role is not FOUNDER — including
 * a fully valid Owner/Admin/VP/Teacher credential — is rejected as
 * NoAccountError after paying the same bcrypt cost as a real Founder
 * account, so this entry point cannot be used to authenticate (even
 * momentarily) as a non-Founder user, and cannot be used to probe whether a
 * given email belongs to a Founder account.
 *
 * Founder accounts are platform-level and never tied to a school, so
 * (matching the pre-existing design) they are deliberately kept outside the
 * per-school lockout/quota bucket system used for staff/teacher logins —
 * only the IP+email rate limit below applies.
 */
export async function authenticateFounderForWeb(email: string, password: string, headers: Headers): Promise<WebLoginResult> {
  const ip = getClientIpFromHeaders(headers);
  const normalizedEmail = email.trim();

  const limit = await rateLimit(`founder-login:${ip ?? "unknown"}:${normalizedEmail.toLowerCase()}`, RATE_LIMIT_POLICIES.login);
  if (!limit.allowed) throw new RateLimitedError();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new NoAccountError();

  const valid = await bcrypt.compare(password, user.password);
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
    throw new InvalidPasswordError();
  }

  if (user.role !== "FOUNDER") {
    await logAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      userId: user.id,
      actorRole: user.role,
      ipAddress: ip,
      metadata: { reason: "role_not_founder" },
    });
    throw new NoAccountError();
  }

  await logAudit({
    action: "LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
    actorRole: user.role,
    ipAddress: ip,
  });

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
