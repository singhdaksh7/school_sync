import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createArrangementsForLeave } from "@/lib/arrangements";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; leaveId: string }> }
) {
  const { schoolId, leaveId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { status } = patchSchema.parse(body);

    // Fetch the leave request before updating so we have the details
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { id: leaveId, schoolId },
    });
    if (!leaveRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Update status
    await prisma.leaveRequest.update({
      where: { id: leaveId },
      data: { status, reviewedById: session.user.id },
    });

    // If a TEACHER leave just got APPROVED, auto-create arrangements
    if (status === "APPROVED" && leaveRequest.type === "TEACHER" && leaveRequest.teacherId) {
      await createArrangementsForLeave(
        leaveId,
        leaveRequest.teacherId,
        schoolId,
        leaveRequest.fromDate,
        leaveRequest.toDate
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; leaveId: string }> }
) {
  const { schoolId, leaveId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.leaveRequest.deleteMany({ where: { id: leaveId, schoolId } });
  return NextResponse.json({ success: true });
}
