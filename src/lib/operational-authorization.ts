/**
 * Teacher Operations Head & Automatic Delegation (Phase 3) — central
 * authorization guard (PART 11/12) and effective-permission composition.
 *
 * Two-step flow per request (PART 12), split across TWO call sites
 * deliberately, not merged into one function:
 *   1. The route's EXISTING check (canAccessSchool/canWriteSchool for
 *      Owner/Admin/VP, or authorizeTeacher/requireSchoolAccess for a
 *      teacher's own base/custom-role permission) — UNCHANGED, tried first.
 *   2. ONLY if step 1 denies AND the actor is a TEACHER: this module's
 *      `canManageTeacherOperations` — the operational-delegation fallback.
 * Owner/Admin never reach step 2 (they already pass step 1); this keeps
 * "Do not route Admin through the teacher operational-role resolver" true
 * by construction, not by a role check inside this file.
 *
 * The operational bundle is granted UNIFORMLY to whichever teacher is
 * currently effective — there is no per-capability differentiation between
 * Primary and Alternate (both get the full bundle while effective). The
 * `capability` parameter exists for call-site clarity and audit-trail
 * labeling, not to gate a subset.
 */

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { schoolLifecycleGate } from "@/lib/school-access";
import { resolveEffectiveOperationalRole, type AvailabilityReasonCode, type OperationalRoleType } from "@/lib/operational-role-resolver";
import { TEACHER_OPERATIONS_CAPABILITIES, type TeacherOperationsCapability } from "@/lib/operational-capabilities";
import { getTeacherPermissions, getTeacherScope, type PermissionPair, type PermissionModule } from "@/lib/teacher-permissions";
import { requireSchoolAccess } from "@/lib/teacher-authorization";

const DEFAULT_ROLE_TYPE: OperationalRoleType = "TEACHER_OPERATIONS";

export interface OperationalAuthorizationContext {
  allowed: boolean;
  source: "TEACHER_OPERATIONS_EFFECTIVE" | "NOT_EFFECTIVE";
  /** false for the Primary (priority 0), true for any effective Alternate. */
  delegated: boolean;
  effectiveAssignmentId: string | null;
  priority: number | null;
  primaryTeacherId: string | null;
  reasonCode: AvailabilityReasonCode;
}

/**
 * Step-2 guard: is `teacherId` CURRENTLY the effective TEACHER_OPERATIONS
 * assignee? Re-resolved from live facts on every call — never trusts a
 * previously-returned client value (PART 32).
 */
export async function canManageTeacherOperations(args: {
  schoolId: string;
  teacherId: string;
  capability: TeacherOperationsCapability;
  roleType?: OperationalRoleType;
  at?: Date;
}): Promise<OperationalAuthorizationContext> {
  void args.capability; // retained for call-site/audit clarity — see module docstring
  const roleType = args.roleType ?? DEFAULT_ROLE_TYPE;
  const resolved = await resolveEffectiveOperationalRole({ schoolId: args.schoolId, roleType, at: args.at });

  if (!resolved.effectiveTeacher || resolved.effectiveTeacher.id !== args.teacherId) {
    return {
      allowed: false,
      source: "NOT_EFFECTIVE",
      delegated: false,
      effectiveAssignmentId: null,
      priority: null,
      primaryTeacherId: resolved.primaryTeacher?.id ?? null,
      reasonCode: resolved.reasonCode,
    };
  }

  return {
    allowed: true,
    source: "TEACHER_OPERATIONS_EFFECTIVE",
    delegated: resolved.effectivePriority !== 0,
    effectiveAssignmentId: resolved.effectiveAssignmentId,
    priority: resolved.effectivePriority,
    primaryTeacherId: resolved.primaryTeacher?.id ?? null,
    reasonCode: resolved.reasonCode,
  };
}

export type CapabilityAuthResult =
  | { ok: true; teacherId: string | null; operational: OperationalAuthorizationContext | null }
  | { ok: false; response: NextResponse };

/**
 * For NON-`/operations/*` routes that already call `requireSchoolAccess`
 * (leaves, arrangements): try that EXISTING check first (Owner/Admin, or a
 * teacher with a direct custom-role grant — completely unchanged); only on
 * denial, and only for a TEACHER actor, fall back to the effective
 * Operations Head path. Mirrors `operations-route-guard.ts`'s
 * `guardOperationsCapability` two-step flow for routes outside that family.
 */
export async function requireSchoolAccessOrOperationalCapability(
  schoolId: string,
  userId: string,
  role: string | undefined,
  module: PermissionModule,
  action: string,
  capability: TeacherOperationsCapability
): Promise<CapabilityAuthResult> {
  const base = await requireSchoolAccess(schoolId, userId, role, module, action);
  if (base.ok) return { ok: true, teacherId: base.teacherId, operational: null };

  if (role !== "TEACHER") return { ok: false, response: base.response };

  // PART 28: `requireSchoolAccess` above already applies the lifecycle gate,
  // but its single response can't tell us WHY it denied (lifecycle vs simply
  // missing permission) — re-check explicitly so a SUSPENDED/EXPIRED school
  // can never fall through into the operational-delegation path below.
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };

  const teacher = await prisma.teacher.findFirst({ where: { userId, isDeleted: false }, select: { id: true, schoolId: true } });
  if (!teacher || teacher.schoolId !== schoolId) return { ok: false, response: base.response };

  const operational = await canManageTeacherOperations({ schoolId, teacherId: teacher.id, capability });
  if (!operational.allowed) return { ok: false, response: base.response };

  return { ok: true, teacherId: teacher.id, operational };
}

export interface EffectiveTeacherPermissions {
  /** Existing custom-role scope semantics (unchanged) — see teacher-permissions.ts. */
  unrestricted: boolean;
  /** Existing custom-role grants (source=BASE/CUSTOM_ROLE, already-allowed pairs only). */
  customRolePermissions: PermissionPair[];
  /** Granted only while this teacher is the effective TEACHER_OPERATIONS assignee. */
  operationalCapabilities: TeacherOperationsCapability[];
  operational: (Omit<OperationalAuthorizationContext, "allowed" | "source"> & { source: "TEACHER_OPERATIONS_EFFECTIVE" }) | null;
}

/**
 * Composed read-model of "everything this teacher can currently do" (PART
 * 11) — used by the teacher self-status API, NOT by the per-request mutation
 * guard above (which re-resolves independently so a stale composed snapshot
 * can never authorize a write).
 */
export async function resolveTeacherEffectivePermissions(args: {
  schoolId: string;
  teacherId: string;
  at?: Date;
}): Promise<EffectiveTeacherPermissions> {
  const [customRolePermissions, scope, resolved] = await Promise.all([
    getTeacherPermissions(args.teacherId, args.schoolId),
    getTeacherScope(args.teacherId, args.schoolId),
    resolveEffectiveOperationalRole({ schoolId: args.schoolId, roleType: DEFAULT_ROLE_TYPE, at: args.at }),
  ]);

  const isEffective = resolved.effectiveTeacher?.id === args.teacherId;

  return {
    unrestricted: scope.unrestricted,
    customRolePermissions,
    operationalCapabilities: isEffective ? [...TEACHER_OPERATIONS_CAPABILITIES] : [],
    operational: isEffective
      ? {
          delegated: resolved.effectivePriority !== 0,
          effectiveAssignmentId: resolved.effectiveAssignmentId,
          priority: resolved.effectivePriority,
          primaryTeacherId: resolved.primaryTeacher?.id ?? null,
          reasonCode: resolved.reasonCode,
          source: "TEACHER_OPERATIONS_EFFECTIVE",
        }
      : null,
  };
}
