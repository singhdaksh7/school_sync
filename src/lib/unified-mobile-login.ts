/**
 * Unified parent/student mobile login (PART 3). One entry point for BOTH
 * actor types — the caller never declares which one they are; the backend
 * resolves it from the credential itself. Teacher/staff remain on the
 * separate staff login flow (authenticateStaffForMobile) — a different
 * credential shape (email, not phone/admission number) and a materially
 * different authorization surface, so unifying them would blur, not simplify,
 * the security model.
 *
 * Ambiguity is FAIL CLOSED: if the same normalized credential legitimately
 * verifies against both an eligible guardian AND an eligible student in the
 * same school, neither is chosen — a generic response is returned and the
 * specific conflict is only visible in server-side logs (never to the
 * caller), so an unauthenticated caller can never learn "this identifier
 * belongs to both a student and a parent".
 */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { statusIsBlocked } from "@/lib/school-access";
import { normalizePhone } from "@/lib/parent-auth";
import { studentPasswordMatches } from "@/lib/mobile-auth";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulLogin } from "@/lib/auth-login-flow";
import { hashIp } from "@/lib/identifier-hash";
import { systemClock } from "@/lib/clock";
import type { ActorIdentity } from "@/lib/auth-login-quota";
import type { DeviceInfo } from "@/lib/auth-sessions";

export type UnifiedLoginOutcome =
  | {
      ok: true;
      actorType: "PARENT";
      rawSessionId: string;
      guardian: { id: string; name: string; phone: string; email: string | null };
      school: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; appName: string | null };
    }
  | {
      ok: true;
      actorType: "STUDENT";
      rawSessionId: string;
      student: { id: string; name: string; rollNo: string; admissionNo: string | null; email: string | null; schoolId: string; sectionId: string };
      school: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; appName: string | null };
    }
  | { ok: false; status: 401 | 403 | 429; code: string; error: string; retryAfterSeconds?: number | null };

export async function unifiedMobileLogin(args: {
  identifier: string;
  password: string;
  schoolSlug?: string | null;
  headers: Headers;
  device: DeviceInfo;
  now?: Date;
}): Promise<UnifiedLoginOutcome> {
  const now = args.now ?? systemClock.now();
  const identifier = args.identifier.trim();

  const resolvedSchoolRef =
    (await resolveSchool(hostnameFromHeaders(args.headers))) ??
    (args.schoolSlug ? await prisma.school.findUnique({ where: { slug: args.schoolSlug }, select: { id: true } }) : null);

  if (!resolvedSchoolRef) {
    // "Wrong school" fails exactly like invalid credentials — never a
    // distinct signal an unauthenticated caller could use to enumerate schools.
    return { ok: false, status: 401, code: "INVALID_CREDENTIALS", error: "Invalid credentials" };
  }

  const resolvedSchool = await prisma.school.findUniqueOrThrow({
    where: { id: resolvedSchoolRef.id },
    select: { id: true, name: true, slug: true, status: true, logoUrl: true, primaryColor: true, secondaryColor: true, appName: true },
  });

  const bucketKey = authBucketKey(resolvedSchool.id, "PARENT_STUDENT", identifier);
  const lock = await guardAgainstLock(bucketKey, now);
  if (lock.locked) {
    return {
      ok: false,
      status: 429,
      code: lock.retryAfterSeconds && lock.retryAfterSeconds > 20 * 60 ? "AUTH_TEMPORARILY_LOCKED" : "AUTH_COOLDOWN_ACTIVE",
      error: "Unable to sign in right now. Please try again later.",
      retryAfterSeconds: lock.retryAfterSeconds,
    };
  }

  const normalizedPhone = normalizePhone(identifier);
  const [guardian, students] = await Promise.all([
    normalizedPhone ? prisma.guardian.findFirst({ where: { schoolId: resolvedSchool.id, phone: normalizedPhone } }) : null,
    prisma.student.findMany({ where: { schoolId: resolvedSchool.id, admissionNo: identifier } }),
  ]);

  const guardianValid = Boolean(guardian?.passwordHash && (await bcrypt.compare(args.password, guardian.passwordHash)));
  const validStudents = [];
  for (const s of students) {
    if (await studentPasswordMatches(s, args.password)) validStudents.push(s);
  }
  const studentValid = validStudents.length > 0;

  if (guardianValid && studentValid) {
    // Fail closed. Internal-only diagnostic — never surfaced to the caller.
    console.error("[unified-mobile-login] ambiguous credential matched both a guardian and a student", {
      schoolId: resolvedSchool.id,
      guardianId: guardian!.id,
      studentIds: validStudents.map((s) => s.id),
    });
    await recordFailedCredential(bucketKey, resolvedSchool.id, "PARENT_STUDENT", now);
    return { ok: false, status: 401, code: "INVALID_CREDENTIALS", error: "Invalid credentials" };
  }

  if (!guardianValid && !studentValid) {
    const afterFailure = await recordFailedCredential(bucketKey, resolvedSchool.id, "PARENT_STUDENT", now);
    if (afterFailure.locked) {
      return {
        ok: false,
        status: 429,
        code: afterFailure.retryAfterSeconds && afterFailure.retryAfterSeconds > 20 * 60 ? "AUTH_TEMPORARILY_LOCKED" : "AUTH_COOLDOWN_ACTIVE",
        error: "Unable to sign in right now. Please try again later.",
        retryAfterSeconds: afterFailure.retryAfterSeconds,
      };
    }
    return { ok: false, status: 401, code: "INVALID_CREDENTIALS", error: "Invalid credentials" };
  }

  if (statusIsBlocked(resolvedSchool.status)) {
    return { ok: false, status: 403, code: "SCHOOL_BLOCKED", error: "School access is currently unavailable" };
  }

  const ipHash = (() => {
    const forwarded = args.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const real = args.headers.get("x-real-ip")?.trim();
    const ip = forwarded || real;
    return ip ? hashIp(ip) : null;
  })();

  const schoolBranding = resolvedSchool;

  if (guardianValid) {
    const actor: ActorIdentity = { schoolId: resolvedSchool.id, actorType: "PARENT", guardianId: guardian!.id };
    const completion = await completeSuccessfulLogin({ bucketKey, actor, device: args.device, now, ipHash });
    if (!completion.ok) {
      return { ok: false, status: 429, code: completion.code, error: "Too many new sign-ins. Please try again later.", retryAfterSeconds: completion.retryAfterSeconds };
    }
    return {
      ok: true,
      actorType: "PARENT",
      rawSessionId: completion.rawSessionId,
      guardian: { id: guardian!.id, name: guardian!.name, phone: guardian!.phone, email: guardian!.email },
      school: schoolBranding,
    };
  }

  const student = validStudents[0];
  const actor: ActorIdentity = { schoolId: resolvedSchool.id, actorType: "STUDENT", studentId: student.id };
  const completion = await completeSuccessfulLogin({ bucketKey, actor, device: args.device, now, ipHash });
  if (!completion.ok) {
    return { ok: false, status: 429, code: completion.code, error: "Too many new sign-ins. Please try again later.", retryAfterSeconds: completion.retryAfterSeconds };
  }
  return {
    ok: true,
    actorType: "STUDENT",
    rawSessionId: completion.rawSessionId,
    student: {
      id: student.id,
      name: student.name,
      rollNo: student.rollNo,
      admissionNo: student.admissionNo,
      email: student.email,
      schoolId: student.schoolId,
      sectionId: student.sectionId,
    },
    school: schoolBranding,
  };
}
