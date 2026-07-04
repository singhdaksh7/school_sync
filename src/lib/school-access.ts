import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Central school access policy: which base roles may use generic school-admin
 * APIs, and which school lifecycle statuses block access.
 *
 * Split out from tenant.ts so the pure predicates (no Prisma import needed at
 * the call site) can be unit-tested and reused by auth/mobile/parent flows
 * without pulling in the whole tenant helper surface.
 */

// Base roles allowed to reach generic school-administration READ endpoints.
// TEACHER is deliberately excluded: a teacher only ever gets access through the
// scoped RBAC layer (requireSchoolAccess / requireTeacherPermission), never
// merely because User.schoolId happens to be set.
export const SCHOOL_ADMIN_READ_ROLES = ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"] as const;

// Base roles allowed to perform generic school WRITE operations. VICE_PRINCIPAL
// is read-only per the project's existing canWriteSchool policy.
export const SCHOOL_ADMIN_WRITE_ROLES = ["SCHOOL_OWNER", "SCHOOL_ADMIN"] as const;

export function isSchoolAdminReadRole(role: string | null | undefined): boolean {
  return (SCHOOL_ADMIN_READ_ROLES as readonly string[]).includes(role ?? "");
}

export function isSchoolAdminWriteRole(role: string | null | undefined): boolean {
  return (SCHOOL_ADMIN_WRITE_ROLES as readonly string[]).includes(role ?? "");
}

// ─── Lifecycle status ────────────────────────────────────────────────────────
// SUSPENDED (deliberate block) and EXPIRED (lapsed subscription) both cut off
// all school users server-side. ACTIVE and TRIAL are normal-access states.

const BLOCKING_STATUSES = new Set(["SUSPENDED", "EXPIRED"]);

export function statusIsBlocked(status: string | null | undefined): boolean {
  return BLOCKING_STATUSES.has(status ?? "");
}

/** Generic, billing-detail-free message shown to blocked school users. */
export function schoolBlockedMessage(status: string | null | undefined): string {
  return status === "EXPIRED" ? "School access has expired" : "School access is suspended";
}

/**
 * Re-reads the school's CURRENT status from the DB (never trusts a stale
 * session/JWT) and returns a 403 response if the school is suspended/expired,
 * or null if access may continue. Used at API entrypoints.
 */
export async function schoolLifecycleGate(schoolId: string): Promise<NextResponse | null> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { status: true } });
  if (school && statusIsBlocked(school.status)) {
    return NextResponse.json({ error: schoolBlockedMessage(school.status) }, { status: 403 });
  }
  return null;
}

/** Boolean form of {@link schoolLifecycleGate} for non-route callers (auth/mobile/parent). */
export async function isSchoolBlocked(schoolId: string): Promise<boolean> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { status: true } });
  return statusIsBlocked(school?.status);
}
