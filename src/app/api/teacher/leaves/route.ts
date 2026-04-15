import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacher(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const leaves = await prisma.leaveRequest.findMany({
    where: { teacherId: teacher.id, schoolId: teacher.schoolId },
    include: { reviewedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(leaves);
}

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
  fromDate: z.string(),
  toDate: z.string(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacher(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { reason, fromDate, toDate } = schema.parse(body);

    if (toDate < fromDate) return NextResponse.json({ error: "To date must be on or after from date" }, { status: 400 });

    const leave = await prisma.leaveRequest.create({
      data: {
        type: "TEACHER",
        reason,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
      },
      include: { reviewedBy: { select: { name: true } } },
    });

    return NextResponse.json(leave, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
