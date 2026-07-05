/**
 * Teacher Operations Head & Automatic Delegation (Phase 3) — data model
 * layer (PART 3/4). `OperationalRoleAssignment` is an ORDERED leadership
 * chain per (schoolId, roleType): priority 0 is Primary, priority 1..N are
 * Alternate 1..N. This module owns validation and transactional
 * configuration of that chain — it never computes availability/failover
 * (see operational-role-resolver.ts for that).
 *
 * `roleType` is a plain string (matching the existing FeeStructure.frequency
 * precedent) — only "TEACHER_OPERATIONS" is implemented/validated this
 * phase; the architecture is extensible to a future role type without a
 * schema migration, but this phase deliberately does not implement one.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const OPERATIONAL_ROLE_TYPES = ["TEACHER_OPERATIONS"] as const;
export type OperationalRoleType = (typeof OPERATIONAL_ROLE_TYPES)[number];

export function isOperationalRoleType(value: unknown): value is OperationalRoleType {
  return (OPERATIONAL_ROLE_TYPES as readonly string[]).includes(value as string);
}

export interface AssignmentInput {
  teacherId: string;
  priority: number;
  isEnabled?: boolean;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
}

export interface OperationalRoleAssignmentRow {
  id: string;
  teacherId: string;
  teacherName: string;
  priority: number;
  isEnabled: boolean;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ConfigureChainResult =
  | { ok: true; assignments: OperationalRoleAssignmentRow[] }
  | { ok: false; error: string; code: string };

/**
 * Validates and atomically replaces the ENTIRE ordered chain for one
 * (schoolId, roleType) — never a partial save. Structural validation (shape,
 * duplicates, effective-date ordering) runs before any DB write; DB-backed
 * validation (teacher exists/same-school/not-deleted) runs before the
 * transaction. The transaction itself deletes the existing chain and inserts
 * the new one — safe because DB unique constraints
 * (schoolId,roleType,teacherId) / (schoolId,roleType,priority) still guard
 * against a concurrent conflicting write (PART 32).
 */
export async function configureOperationalRoleChain(args: {
  schoolId: string;
  roleType: OperationalRoleType;
  assignments: AssignmentInput[];
  createdById: string;
}): Promise<ConfigureChainResult> {
  const { schoolId, roleType, assignments, createdById } = args;

  if (assignments.length === 0) {
    return { ok: false, error: "At least one assignment is required", code: "EMPTY_CHAIN" };
  }

  const seenTeachers = new Set<string>();
  const seenPriorities = new Set<number>();
  for (const a of assignments) {
    if (!Number.isInteger(a.priority) || a.priority < 0) {
      return { ok: false, error: `Priority must be a non-negative integer (teacher ${a.teacherId})`, code: "INVALID_PRIORITY" };
    }
    if (seenPriorities.has(a.priority)) {
      return { ok: false, error: `Duplicate priority ${a.priority} in submitted chain`, code: "DUPLICATE_PRIORITY" };
    }
    seenPriorities.add(a.priority);
    if (seenTeachers.has(a.teacherId)) {
      return { ok: false, error: `Teacher ${a.teacherId} appears more than once in submitted chain`, code: "DUPLICATE_TEACHER" };
    }
    seenTeachers.add(a.teacherId);
    if (a.effectiveFrom && a.effectiveUntil && a.effectiveUntil < a.effectiveFrom) {
      return { ok: false, error: `effectiveUntil is before effectiveFrom for teacher ${a.teacherId}`, code: "INVALID_EFFECTIVE_RANGE" };
    }
  }

  // Every teacher must belong to THIS school and not be soft-deleted — a
  // foreign-school teacher or a deleted teacher rejects the WHOLE update.
  const validTeachers = await prisma.teacher.findMany({
    where: { id: { in: [...seenTeachers] }, schoolId, isDeleted: false },
    select: { id: true },
  });
  const validIds = new Set(validTeachers.map((t) => t.id));
  const invalidIds = [...seenTeachers].filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    return { ok: false, error: `Teacher(s) not found in this school (or deleted): ${invalidIds.join(", ")}`, code: "INVALID_TEACHER" };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.operationalRoleAssignment.deleteMany({ where: { schoolId, roleType } });
    const rows: Prisma.OperationalRoleAssignmentGetPayload<{ include: { teacher: { select: { name: true } } } }>[] = [];
    for (const a of assignments) {
      rows.push(
        await tx.operationalRoleAssignment.create({
          data: {
            schoolId,
            roleType,
            teacherId: a.teacherId,
            priority: a.priority,
            isEnabled: a.isEnabled ?? true,
            effectiveFrom: a.effectiveFrom ?? null,
            effectiveUntil: a.effectiveUntil ?? null,
            createdById,
          },
          include: { teacher: { select: { name: true } } },
        })
      );
    }
    return rows;
  });

  return {
    ok: true,
    assignments: created
      .sort((a, b) => a.priority - b.priority)
      .map((a) => ({
        id: a.id,
        teacherId: a.teacherId,
        teacherName: a.teacher.name,
        priority: a.priority,
        isEnabled: a.isEnabled,
        effectiveFrom: a.effectiveFrom,
        effectiveUntil: a.effectiveUntil,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
  };
}

/** Raw (non-availability-resolved) chain read — for the Admin configuration GET endpoint. */
export async function getOperationalRoleChain(schoolId: string, roleType: OperationalRoleType): Promise<OperationalRoleAssignmentRow[]> {
  const rows = await prisma.operationalRoleAssignment.findMany({
    where: { schoolId, roleType },
    orderBy: { priority: "asc" },
    include: { teacher: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    teacherId: a.teacherId,
    teacherName: a.teacher.name,
    priority: a.priority,
    isEnabled: a.isEnabled,
    effectiveFrom: a.effectiveFrom,
    effectiveUntil: a.effectiveUntil,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}
