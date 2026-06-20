import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";

const SAME_DAY_CUTOFF_HOUR = 7;
const SAME_DAY_CUTOFF_MINUTE = 30;

function dateOnly(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Same-day leave is only allowed before 7:30 AM local time; after that, the
// student may still request leave for any future date, just not for today.
function sameDayCutoffPassed(now = new Date()) {
  return now.getHours() > SAME_DAY_CUTOFF_HOUR || (now.getHours() === SAME_DAY_CUTOFF_HOUR && now.getMinutes() >= SAME_DAY_CUTOFF_MINUTE);
}

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

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (toDate < fromDate) return NextResponse.json({ error: "To date must be on or after from date" }, { status: 400 });

    const today = dateOnly(new Date());
    const fromDateOnly = dateOnly(from);
    if (fromDateOnly < today) {
      return NextResponse.json({ error: "Cannot request leave for a past date" }, { status: 400 });
    }
    if (fromDateOnly.getTime() === today.getTime() && sameDayCutoffPassed()) {
      return NextResponse.json(
        { error: "Same-day leave can only be requested before 7:30 AM. Please choose a future date." },
        { status: 400 }
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        type: "STUDENT",
        reason: `${leaveType}: ${reason}`,
        fromDate: from,
        toDate: to,
        studentId: auth.studentId,
        schoolId: auth.schoolId,
      },
      include: { reviewedBy: { select: { name: true } } },
    });

    return NextResponse.json(leave, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Error creating student leave request:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
