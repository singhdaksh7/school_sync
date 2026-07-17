import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import { teacherHasPermission } from "@/lib/teacher-permissions";

/**
 * Certificates staff RBAC — re-derived from the roles that actually exist in
 * prisma/schema.prisma's UserRole enum (SCHOOL_OWNER, SCHOOL_ADMIN,
 * VICE_PRINCIPAL, TEACHER, FOUNDER, STUDENT), mirroring the reasoning already
 * documented in src/lib/admissions/authorization.ts (no PRINCIPAL/GUARDIAN
 * role exists here; guardians authenticate through the separate parent-portal
 * identity in src/lib/parent-auth.ts, never through this staff module).
 *
 * Management actions (spec §9): REQUEST_VIEW, REVIEW, APPROVE, REJECT,
 * ISSUE, REVOKE, TEMPLATE_MANAGE, REPORT_VIEW.
 *
 * - SCHOOL_OWNER / SCHOOL_ADMIN: every action, school-scoped.
 * - VICE_PRINCIPAL: a narrow review-only surface (REQUEST_VIEW, REVIEW,
 *   APPROVE, REJECT, REPORT_VIEW) — consistent with the VP's existing
 *   read-mostly footprint elsewhere in the app (see admissions'
 *   REVIEW_WRITE_ROLES precedent). ISSUE/REVOKE/TEMPLATE_MANAGE (producing
 *   and invalidating the actual legal-adjacent document) stay OWNER/ADMIN
 *   only, or explicitly delegated below.
 * - TEACHER: no access by default. May be delegated any subset of the above
 *   actions via TeacherCustomRole's CERTIFICATES permission module (see
 *   src/lib/teacher-permissions.ts) — this is the "delegated staff" path
 *   the spec asks for.
 */

export type CertificateManagementAction =
  | "REQUEST_VIEW"
  | "REVIEW"
  | "APPROVE"
  | "REJECT"
  | "ISSUE"
  | "REVOKE"
  | "TEMPLATE_MANAGE"
  | "REPORT_VIEW";

export type CertificateActor = { userId: string; role: string; teacherId: string | null };

type AccessResult = { ok: true; actor: CertificateActor } | { ok: false; response: NextResponse };

const FULL_ACCESS_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN"]);
const VICE_PRINCIPAL_ACTIONS = new Set<CertificateManagementAction>(["REQUEST_VIEW", "REVIEW", "APPROVE", "REJECT", "REPORT_VIEW"]);

function notFound() {
  // Cross-school / non-member access returns 404, never 403 — matches the
  // admissions convention (never reveal whether a resource exists).
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
function forbidden(reason: string) {
  return NextResponse.json({ error: "Forbidden", reason }, { status: 403 });
}

async function resolveActor(schoolId: string, userId: string): Promise<CertificateActor | null> {
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
export async function loadCertificateActor(schoolId: string, userId: string): Promise<AccessResult> {
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };
  const actor = await resolveActor(schoolId, userId);
  if (!actor) return { ok: false, response: notFound() };
  return { ok: true, actor };
}

/** The one authorization guard every staff Certificates route calls, naming the exact action it needs. */
export async function requireCertificateAction(
  schoolId: string,
  userId: string,
  action: CertificateManagementAction
): Promise<AccessResult> {
  const base = await loadCertificateActor(schoolId, userId);
  if (!base.ok) return base;
  const { actor } = base;

  if (FULL_ACCESS_ROLES.has(actor.role)) return base;

  if (actor.role === "VICE_PRINCIPAL" && VICE_PRINCIPAL_ACTIONS.has(action)) return base;

  if (actor.role === "TEACHER" && actor.teacherId) {
    const allowed = await teacherHasPermission(actor.teacherId, schoolId, "CERTIFICATES", action);
    if (allowed) return base;
  }

  return { ok: false, response: forbidden("MISSING_PERMISSION") };
}

/**
 * Self-review restriction (spec §9): a staff member who filed a request on
 * behalf of a student they administer must not also be the one who
 * reviews/approves/rejects/issues/revokes that same request. Call after
 * requireCertificateAction succeeds, before applying the transition.
 */
export function assertNoSelfReviewConflict(
  actor: CertificateActor,
  request: { requesterType: string; requesterUserId: string | null }
): NextResponse | null {
  if (request.requesterType === "STAFF" && request.requesterUserId === actor.userId) {
    return forbidden("SELF_REVIEW_NOT_ALLOWED");
  }
  return null;
}
