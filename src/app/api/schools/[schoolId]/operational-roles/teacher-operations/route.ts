import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getOperationalRoleChain, configureOperationalRoleChain, type AssignmentInput } from "@/lib/operational-roles";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";
import { logAudit } from "@/lib/audit";

const ROLE_TYPE = "TEACHER_OPERATIONS" as const;

/**
 * Admin configuration API (PART 21). GET returns the raw ordered chain plus
 * the currently-resolved effective status (Owner/Admin/VP read, matching
 * generic school-admin read semantics). PUT atomically replaces the WHOLE
 * chain (never a partial save) — Owner/Admin only, gated by TEACHER_PERMISSIONS
 * (PART 27: the same entitlement that already gates custom teacher role
 * configuration) since configuring a leadership chain is the same kind of
 * paid "custom teacher authority" capability. Already-configured assignments
 * keep resolving via GET/effective even if the entitlement later lapses —
 * only NEW configuration is blocked — so a school is never left with a
 * silently-broken chain because of a billing change.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }
  const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
  if (denied) return denied;

  const [chain, effective] = await Promise.all([
    getOperationalRoleChain(schoolId, ROLE_TYPE),
    resolveEffectiveOperationalRole({ schoolId, roleType: ROLE_TYPE }),
  ]);

  return NextResponse.json({ roleType: ROLE_TYPE, assignments: chain, effective });
}

const assignmentSchema = z.object({
  teacherId: z.string().min(1),
  priority: z.number().int().nonnegative(),
  isEnabled: z.boolean().optional(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveUntil: z.string().nullable().optional(),
});
const putSchema = z.object({ assignments: z.array(assignmentSchema).min(1) });

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  try {
    const body = putSchema.parse(await req.json());
    const before = await getOperationalRoleChain(schoolId, ROLE_TYPE);

    const assignments: AssignmentInput[] = body.assignments.map((a) => ({
      teacherId: a.teacherId,
      priority: a.priority,
      isEnabled: a.isEnabled,
      effectiveFrom: a.effectiveFrom ? new Date(a.effectiveFrom) : null,
      effectiveUntil: a.effectiveUntil ? new Date(a.effectiveUntil) : null,
    }));

    const result = await configureOperationalRoleChain({ schoolId, roleType: ROLE_TYPE, assignments, createdById: session.user.id });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });

    await logAudit({
      action: "TEACHER_OPERATIONS_CHAIN_UPDATED",
      entityType: "OperationalRoleAssignment",
      metadata: {
        roleType: ROLE_TYPE,
        before: before.map((a) => ({ teacherId: a.teacherId, priority: a.priority, isEnabled: a.isEnabled })),
        after: result.assignments.map((a) => ({ teacherId: a.teacherId, priority: a.priority, isEnabled: a.isEnabled })),
      },
      userId: session.user.id,
      schoolId,
      actorRole: role,
    });

    return NextResponse.json({ roleType: ROLE_TYPE, assignments: result.assignments });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
