import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, sessionRole } from "@/lib/tenant";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";

const ROLE_TYPE = "TEACHER_OPERATIONS" as const;

/**
 * Focused effective-status read API (PART 22). Owner/Admin/VP (generic
 * school-admin read semantics, unchanged) OR any teacher in this school may
 * read it — a teacher needs this to know who currently holds the role even
 * when they are not the effective assignee themselves (e.g. to know who to
 * escalate to). This does NOT grant any operational capability by itself —
 * it is a read, resolved fresh on every call, never cached as authority.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const role = sessionRole(session.user);

  let allowed = await canAccessSchool(schoolId, userId);
  if (!allowed && role === "TEACHER") {
    const teacher = await prisma.teacher.findFirst({ where: { userId, isDeleted: false }, select: { schoolId: true } });
    allowed = Boolean(teacher && teacher.schoolId === schoolId);
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await enforceActorRateLimit({ schoolId, actorType: role === "TEACHER" ? "TEACHER" : "ADMIN_STAFF", actorId: userId }, "STANDARD_READ");
  if (denied) return denied;

  const effective = await resolveEffectiveOperationalRole({ schoolId, roleType: ROLE_TYPE });
  return NextResponse.json(effective);
}
