import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { validateStudentLeaveDateRange, createStudentLeaveRequest } from "@/lib/student-leave-rules";

export async function GET(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const leaves = await prisma.leaveRequest.findMany({
    where: { studentId: auth.studentId, schoolId: auth.schoolId },
    include: { reviewedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ leaves });
}

const schema = z.object({
  leaveType: z.string().min(1, "Leave type is required"),
  reason: z.string().min(1, "Reason is required"),
  fromDate: z.string(),
  toDate: z.string(),
});

export async function POST(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { leaveType, reason, fromDate, toDate } = schema.parse(body);

    const validated = validateStudentLeaveDateRange(fromDate, toDate);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const leave = await createStudentLeaveRequest({
      schoolId: auth.schoolId,
      studentId: auth.studentId,
      leaveType,
      reason,
      from: validated.from,
      to: validated.to,
    });

    return NextResponse.json(leave, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Error creating student leave request:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
