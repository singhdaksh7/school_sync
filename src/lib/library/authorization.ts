import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import { teacherHasPermission } from "@/lib/teacher-permissions";
import type { LibraryCapability } from "@/lib/library/constants";

/**
 * Library RBAC. Re-derived from the roles that actually exist in
 * prisma/schema.prisma's UserRole enum (SCHOOL_OWNER, SCHOOL_ADMIN,
 * VICE_PRINCIPAL, TEACHER, FOUNDER, STUDENT). There is deliberately NO
 * LIBRARIAN role — library-staff delegation is modelled through the existing
 * TeacherPermission catalog (module "LIBRARY").
 *
 * Access model:
 *   - Leadership (SCHOOL_OWNER / SCHOOL_ADMIN / VICE_PRINCIPAL): full access to
 *     every capability automatically.
 *   - TEACHER: self-service only by default (own loans/reservations via the
 *     /api/teacher/library routes, which use getTeacherAuth, not this module).
 *     A management capability requires the matching LIBRARY:<ACTION> grant.
 *   - STUDENT / cross-tenant / non-member: never reach the staff surface.
 *
 * Denial codes follow the repo's leak-avoidance convention: 404 (not 403) for
 * role/cross-tenant denial where existence must not be revealed; 403 only for a
 * blocked/suspended school (schoolLifecycleGate) and for an authenticated
 * same-school teacher who simply lacks a granted capability (MISSING_PERMISSION,
 * mirroring admissions).
 */

export type LibraryActor = { userId: string; role: string; teacherId: string | null };

export type LibraryAccessResult =
  | { ok: true; actor: LibraryActor }
  | { ok: false; response: NextResponse };

const LEADERSHIP_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"]);

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
function forbidden(reason: string) {
  return NextResponse.json({ error: "Forbidden", reason }, { status: 403 });
}

async function resolveActor(schoolId: string, userId: string): Promise<LibraryActor | null> {
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

/** Base gate: school lifecycle + actor resolution. Authorizes nothing by itself. */
export async function loadLibraryActor(schoolId: string, userId: string): Promise<LibraryAccessResult> {
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };
  const actor = await resolveActor(schoolId, userId);
  if (!actor) return { ok: false, response: notFound() };
  return { ok: true, actor };
}

/**
 * Authorizes a specific library capability. Leadership passes unconditionally;
 * a TEACHER must carry the matching LIBRARY:<capability> grant; anyone else is
 * 404 (never reaches here as a resolved actor except a permission-less teacher).
 */
export async function requireLibraryCapability(
  schoolId: string,
  userId: string,
  capability: LibraryCapability
): Promise<LibraryAccessResult> {
  const base = await loadLibraryActor(schoolId, userId);
  if (!base.ok) return base;
  const { actor } = base;
  if (LEADERSHIP_ROLES.has(actor.role)) return base;
  if (actor.role === "TEACHER" && actor.teacherId) {
    const granted = await teacherHasPermission(actor.teacherId, schoolId, "LIBRARY", capability);
    if (granted) return base;
    return { ok: false, response: forbidden("MISSING_PERMISSION") };
  }
  return { ok: false, response: notFound() };
}

export const requireLibraryRead = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "VIEW");
export const requireLibraryWrite = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "CATALOGUE_MANAGE");
export const requireLibraryCatalogueManage = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "CATALOGUE_MANAGE");
export const requireLibraryCopyManage = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "COPY_MANAGE");
export const requireLibraryIssue = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "ISSUE");
export const requireLibraryReturn = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "RETURN");
export const requireLibraryRenew = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "RENEW");
export const requireLibraryReservationManage = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "RESERVATION_MANAGE");
export const requireLibraryFineWaive = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "FINE_WAIVE");
export const requireLibraryPolicyManage = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "POLICY_MANAGE");
export const requireLibraryReportView = (schoolId: string, userId: string) =>
  requireLibraryCapability(schoolId, userId, "REPORT_VIEW");
