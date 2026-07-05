/**
 * School Operations Command Center — shared route guard (PART 22/23/25 of
 * Phase 2; extended in Phase 3 PART 13 for the effective Operations Head).
 * Every `/api/schools/[schoolId]/operations/*` route repeats the same
 * auth -> tenant-role -> Cost Guard preamble; centralized here rather than
 * copy-pasted per route.
 *
 * Authorization (PART 23): reuses `canAccessSchool`/`canWriteSchool`
 * (tenant.ts) verbatim — Owner/Admin full access, VICE_PRINCIPAL read-only
 * (canAccessSchool allows it, canWriteSchool explicitly excludes it), TEACHER
 * always denied by THIS PATH (isSchoolAdminReadRole excludes TEACHER by
 * design), FOUNDER denied (not a SCHOOL_ADMIN_READ_ROLES member — Founder
 * access is a separate control plane, see founder.ts). Also re-reads the
 * school's lifecycle status from the DB on every call (via
 * canAccessSchool/canWriteSchool), so a SUSPENDED/EXPIRED school is blocked
 * regardless of role — including the effective Operations Head (PART 28:
 * temporary operational delegation never bypasses school lifecycle).
 *
 * Phase 3 addition: `guardOperationsCapability` implements the PART 12
 * two-step flow for the small set of routes the effective Operations Head
 * may use — try the existing Owner/Admin(/VP for reads) path FIRST; only if
 * that denies AND the caller is a TEACHER, fall back to
 * `canManageTeacherOperations`. Admin/Owner/VP never reach the fallback (they
 * already pass or fail on step 1), so "do not route Admin through the
 * teacher operational-role resolver" holds by construction. Cost Guard is
 * keyed by the REAL acting teacher's id (never a "primary" id, never the
 * admin path's ADMIN_STAFF type) when delegation is the path taken (PART 29).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import type { ApiCostCategory } from "@/lib/cost-guard-policy";
import { canManageTeacherOperations, type OperationalAuthorizationContext } from "@/lib/operational-authorization";
import type { TeacherOperationsCapability } from "@/lib/operational-capabilities";

export interface OperationsRouteContext {
  userId: string;
  role: string | undefined;
  /** Set only when the request was authorized via effective-head delegation. */
  teacherId?: string;
  operational?: OperationalAuthorizationContext;
}

type GuardResult = { ok: true; ctx: OperationsRouteContext } | { ok: false; deny: NextResponse };

async function guard(schoolId: string, category: ApiCostCategory, write: boolean): Promise<GuardResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, deny: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const role = sessionRole(session.user);
  const allowed = write ? await canWriteSchool(schoolId, session.user.id, role) : await canAccessSchool(schoolId, session.user.id);
  if (!allowed) {
    return { ok: false, deny: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, category);
  if (denied) return { ok: false, deny: denied };
  return { ok: true, ctx: { userId: session.user.id, role } };
}

/** For GET/read routes: Owner/Admin/VP may pass. */
export function guardOperationsRead(schoolId: string, category: ApiCostCategory): Promise<GuardResult> {
  return guard(schoolId, category, false);
}

/** For write routes (e.g. bulk teacher daily status): Owner/Admin only — VP is read-only. */
export function guardOperationsWrite(schoolId: string, category: ApiCostCategory): Promise<GuardResult> {
  return guard(schoolId, category, true);
}

/**
 * PART 12/13 two-step guard: Owner/Admin(/VP for reads) first, then — only on
 * denial, and only for a TEACHER actor — the effective Operations Head path.
 * `write=true` uses the Owner/Admin-only step 1 (matching `guardOperationsWrite`);
 * `write=false` uses the Owner/Admin/VP step 1 (matching `guardOperationsRead`).
 */
export async function guardOperationsCapability(
  schoolId: string,
  category: ApiCostCategory,
  capability: TeacherOperationsCapability,
  write: boolean
): Promise<GuardResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, deny: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const role = sessionRole(session.user);
  const userId = session.user.id;

  const adminAllowed = write ? await canWriteSchool(schoolId, userId, role) : await canAccessSchool(schoolId, userId);
  if (adminAllowed) {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: userId }, category);
    if (denied) return { ok: false, deny: denied };
    return { ok: true, ctx: { userId, role } };
  }

  if (role !== "TEACHER") {
    return { ok: false, deny: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  // PART 28: `canAccessSchool`/`canWriteSchool` above already blocked on
  // school lifecycle for the admin path, but a SUSPENDED/EXPIRED school must
  // ALSO block the teacher-delegation fallback — re-checked explicitly here
  // since `canManageTeacherOperations` itself has no lifecycle awareness.
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, deny: blocked };

  // Soft-deleted teachers are never resolved as active — no delegation fallback.
  const teacher = await prisma.teacher.findFirst({ where: { userId, isDeleted: false }, select: { id: true, schoolId: true } });
  if (!teacher || teacher.schoolId !== schoolId) {
    return { ok: false, deny: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const operational = await canManageTeacherOperations({ schoolId, teacherId: teacher.id, capability });
  if (!operational.allowed) {
    return { ok: false, deny: NextResponse.json({ error: "Forbidden", reasonCode: operational.reasonCode }, { status: 403 }) };
  }

  // Actor-keyed by the REAL acting teacher — never the primary's id, never ADMIN_STAFF.
  const denied = await enforceActorRateLimit({ schoolId, actorType: "TEACHER", actorId: teacher.id }, category);
  if (denied) return { ok: false, deny: denied };

  return { ok: true, ctx: { userId, role, teacherId: teacher.id, operational } };
}
