import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";

const ROLE_TYPE = "TEACHER_OPERATIONS" as const;

/**
 * Teacher self-status API (PART 22): answers "Am I managing School
 * Operations today?" for the CALLING teacher specifically — a minimal
 * response, not the full leadership chain (unrelated teachers never see who
 * else is on the chain via this endpoint; use the Admin effective-status API
 * for that). Resolved fresh every call — never trust a cached client value.
 */
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({ where: { id: teacherAuth.teacherId }, select: { id: true, schoolId: true, isDeleted: true } });
  if (!teacher || teacher.isDeleted) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const denied = await enforceActorRateLimit({ schoolId: teacher.schoolId, actorType: "TEACHER", actorId: teacher.id }, "STANDARD_READ");
  if (denied) return denied;

  const effective = await resolveEffectiveOperationalRole({ schoolId: teacher.schoolId, roleType: ROLE_TYPE });
  const isEffectiveOperationsHead = effective.effectiveTeacher?.id === teacher.id;

  return NextResponse.json({
    roleType: ROLE_TYPE,
    isEffectiveOperationsHead,
    delegated: isEffectiveOperationsHead ? effective.effectivePriority !== 0 : false,
    reasonCode: isEffectiveOperationsHead ? effective.reasonCode : null,
  });
}
