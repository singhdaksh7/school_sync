import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { createNotificationsBounded, leadershipRecipientsForSchool } from "@/lib/notifications";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({
    where: { userId },
    include: { school: { select: { periodsPerDay: true } } },
  });
}

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const requests = await prisma.teacherEarlyLeaveRequest.findMany({
    where: { teacherId: teacher.id, schoolId: teacher.schoolId },
    include: { approvedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

const schema = z.object({
  date: z.string(),
  leaveAfterPeriod: z.number().int().min(0),
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { date, leaveAfterPeriod, reason } = schema.parse(body);

    if (leaveAfterPeriod > teacher.school.periodsPerDay) {
      return NextResponse.json(
        { error: `Period must be between 0 and ${teacher.school.periodsPerDay}` },
        { status: 400 }
      );
    }

    const requestDate = new Date(date);
    if (Number.isNaN(requestDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    requestDate.setHours(0, 0, 0, 0);

    // A teacher may only have one active early-leave request per day.
    const clash = await prisma.teacherEarlyLeaveRequest.findFirst({
      where: { teacherId: teacher.id, date: requestDate, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json({ error: "You already have an early-leave request for this date" }, { status: 400 });
    }

    const created = await prisma.teacherEarlyLeaveRequest.create({
      data: {
        schoolId: teacher.schoolId,
        teacherId: teacher.id,
        date: requestDate,
        leaveAfterPeriod,
        reason,
      },
      include: { approvedBy: { select: { name: true } } },
    });

    const reviewers = await leadershipRecipientsForSchool(teacher.schoolId);
    await createNotificationsBounded(prisma, {
      schoolId: teacher.schoolId,
      eventType: "LEAVE_PENDING_REVIEW",
      entityType: "TeacherEarlyLeaveRequest",
      entityId: created.id,
      recipients: reviewers,
      metadata: { requestType: "EARLY_LEAVE" },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
