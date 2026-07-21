import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead, requireLibraryPolicyManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { getEffectiveLibraryPolicy } from "@/lib/library/policy";
import { logAudit } from "@/lib/audit";
import { recordLibraryHistory } from "@/lib/library/history";

const updateSchema = z.object({
  studentBorrowLimit: z.number().int().min(0).max(1000).optional(),
  teacherBorrowLimit: z.number().int().min(0).max(1000).optional(),
  studentLoanDurationDays: z.number().int().min(0).max(3650).optional(),
  teacherLoanDurationDays: z.number().int().min(0).max(3650).optional(),
  maxRenewals: z.number().int().min(0).max(100).optional(),
  graceDays: z.number().int().min(0).max(365).optional(),
  finePerOverdueDay: z.number().nonnegative().max(100000).optional(),
  reservationsEnabled: z.boolean().optional(),
  reservationHoldDurationDays: z.number().int().min(0).max(365).optional(),
  blockBorrowingIfOverdue: z.boolean().optional(),
});

function serialize(p: Awaited<ReturnType<typeof getEffectiveLibraryPolicy>>) {
  return { ...p, finePerOverdueDay: p.finePerOverdueDay.toFixed(2) };
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRead(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const policy = await getEffectiveLibraryPolicy(schoolId);
  return NextResponse.json(serialize(policy));
}

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryPolicyManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { finePerOverdueDay, ...rest } = body;
  const data = {
    ...rest,
    ...(finePerOverdueDay != null ? { finePerOverdueDay: new Prisma.Decimal(finePerOverdueDay) } : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.libraryPolicy.upsert({
      where: { schoolId },
      create: { schoolId, ...data, updatedById: user.userId },
      update: { ...data, updatedById: user.userId },
    });
    await recordLibraryHistory(tx, {
      schoolId,
      event: "POLICY_CHANGED",
      actorId: user.userId,
      actorRole: user.role,
    });
  });

  await logAudit({
    action: "LIBRARY_POLICY_CHANGED",
    entityType: "LibraryPolicy",
    entityId: schoolId,
    userId: user.userId,
    schoolId,
    actorRole: user.role,
  });

  const policy = await getEffectiveLibraryPolicy(schoolId);
  return NextResponse.json(serialize(policy));
}
