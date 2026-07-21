import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";

/**
 * Admissions RBAC — re-derived directly from the roles that actually exist in
 * prisma/schema.prisma's UserRole enum (SCHOOL_OWNER, SCHOOL_ADMIN,
 * VICE_PRINCIPAL, TEACHER, FOUNDER, STUDENT). There is no PRINCIPAL role and
 * no GUARDIAN role in this schema, so the spec's "VICE_PRINCIPAL or
 * PRINCIPAL" clause resolves to VICE_PRINCIPAL only, and the spec's GUARDIAN
 * clause is not applicable (guardians never authenticate into staff routes
 * today; see src/lib/parent-auth.ts for the separate parent-portal identity).
 *
 * Decision on VICE_PRINCIPAL's write scope: the repo's existing generic
 * school-write policy (src/lib/tenant.ts canWriteSchool, src/lib/school-access.ts
 * SCHOOL_ADMIN_WRITE_ROLES) treats VICE_PRINCIPAL as READ-ONLY for ordinary
 * school-admin mutations — there is no existing precedent in this codebase
 * granting VICE_PRINCIPAL any write action. The spec, however, explicitly
 * asks for VICE_PRINCIPAL to "review, schedule assessments, record
 * decisions" if that role exists. Reconciling the two: VICE_PRINCIPAL gets a
 * narrow, explicitly-named write surface in Admissions (review transitions,
 * scheduling/updating interviews & assessments, notes) but NOT the two
 * highest-risk write actions — cycle/offering configuration (create, edit,
 * open/close/archive, capacity) and the enrollment conversion — which stay
 * SCHOOL_OWNER/SCHOOL_ADMIN only, consistent with VP's existing read-only
 * status for every other generic-config write in the app. This is a
 * deliberate interpretation (documented here and in the PR description)
 * since no prior branch's convention was available to copy.
 */

export type AdmissionActor = { userId: string; role: string; teacherId: string | null };

type AccessResult = { ok: true; actor: AdmissionActor } | { ok: false; response: NextResponse };

const CONFIG_WRITE_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN"]);
const REVIEW_WRITE_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"]);
const READ_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"]);
const ENROLLMENT_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN"]);

function notFound() {
  // Cross-school / non-member access returns 404, never 403 — don't reveal
  // whether a resource exists to a caller outside the tenant.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
function forbidden(reason: string) {
  return NextResponse.json({ error: "Forbidden", reason }, { status: 403 });
}

async function resolveActor(schoolId: string, userId: string): Promise<AdmissionActor | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } });
  if (!user) return null;
  const isMember = await canAccessSchool(schoolId, userId);
  if (!isMember && user.role !== "TEACHER") return null;
  if (user.role === "TEACHER" && user.schoolId !== schoolId) return null;
  let teacherId: string | null = null;
  if (user.role === "TEACHER") {
    const teacher = await prisma.teacher.findFirst({ where: { userId, schoolId, isDeleted: false }, select: { id: true } });
    if (!teacher) return null;
    teacherId = teacher.id;
  }
  return { userId, role: user.role, teacherId };
}

/** Base gate: resolves the actor and school lifecycle; does not itself authorize any action. */
export async function loadAdmissionActor(schoolId: string, userId: string): Promise<AccessResult> {
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };
  const actor = await resolveActor(schoolId, userId);
  if (!actor) return { ok: false, response: notFound() };
  return { ok: true, actor };
}

/** Read access to admissions data (dashboard, lists, detail, history, verified-doc metadata). TEACHER excluded — see module doc. */
export async function requireAdmissionRead(schoolId: string, userId: string): Promise<AccessResult> {
  const base = await loadAdmissionActor(schoolId, userId);
  if (!base.ok) return base;
  if (!READ_ROLES.has(base.actor.role)) return { ok: false, response: notFound() };
  return base;
}

/** Cycle/offering configuration + application create/update. OWNER/ADMIN only. */
export async function requireAdmissionConfigWrite(schoolId: string, userId: string): Promise<AccessResult> {
  const base = await loadAdmissionActor(schoolId, userId);
  if (!base.ok) return base;
  if (!CONFIG_WRITE_ROLES.has(base.actor.role)) return { ok: false, response: forbidden("MISSING_PERMISSION") };
  return base;
}

/** Review-workflow writes: status transitions, notes, scheduling/updating interviews & assessments. OWNER/ADMIN/VP. */
export async function requireAdmissionReviewWrite(schoolId: string, userId: string): Promise<AccessResult> {
  const base = await loadAdmissionActor(schoolId, userId);
  if (!base.ok) return base;
  if (!REVIEW_WRITE_ROLES.has(base.actor.role)) return { ok: false, response: forbidden("MISSING_PERMISSION") };
  return base;
}

/** The enrollment-conversion action. OWNER/ADMIN only. */
export async function requireAdmissionEnrollmentWrite(schoolId: string, userId: string): Promise<AccessResult> {
  const base = await loadAdmissionActor(schoolId, userId);
  if (!base.ok) return base;
  if (!ENROLLMENT_ROLES.has(base.actor.role)) return { ok: false, response: forbidden("MISSING_PERMISSION") };
  return base;
}

/**
 * A TEACHER never gets general admissions access. They may only view/act on
 * a specific AdmissionReviewEvent explicitly assigned to them
 * (evaluatorTeacherId === their own teacher id). Returns the actor + the
 * matching event's applicationId, or a 404 (existence never revealed).
 */
export async function requireAssignedEvaluator(
  schoolId: string,
  userId: string,
  reviewEventId: string
): Promise<{ ok: true; actor: AdmissionActor; applicationId: string } | { ok: false; response: NextResponse }> {
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } });
  if (!user) return { ok: false, response: notFound() };

  // Owners/admins/VP go through the normal review-write path instead — this
  // helper is specifically the TEACHER narrow-scope carve-out.
  if (user.role !== "TEACHER" || user.schoolId !== schoolId) return { ok: false, response: notFound() };

  const teacher = await prisma.teacher.findFirst({ where: { userId, schoolId, isDeleted: false }, select: { id: true } });
  if (!teacher) return { ok: false, response: notFound() };

  const event = await prisma.admissionReviewEvent.findFirst({
    where: { id: reviewEventId, schoolId, evaluatorTeacherId: teacher.id },
    select: { applicationId: true },
  });
  if (!event) return { ok: false, response: notFound() };

  return { ok: true, actor: { userId, role: user.role, teacherId: teacher.id }, applicationId: event.applicationId };
}
