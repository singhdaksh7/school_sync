import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

// GET attendance summary for a date range, grouped by student or teacher
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const type = (searchParams.get("type") || "STUDENT") as "STUDENT" | "TEACHER";
  const sectionId = searchParams.get("sectionId");

  if (!from || !to) return NextResponse.json({ error: "from and to dates required" }, { status: 400 });

  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  const records = await prisma.attendance.findMany({
    where: {
      schoolId,
      type,
      date: { gte: fromDate, lte: toDate },
      ...(type === "STUDENT" && sectionId ? { sectionId } : {}),
    },
    include: {
      student: { select: { id: true, name: true, rollNo: true, sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      teacher: { select: { id: true, name: true, subject: true } },
    },
    orderBy: { date: "asc" },
  });

  // Aggregate by student/teacher
  const summaryMap = new Map<string, {
    id: string;
    name: string;
    rollNo?: string;
    subject?: string;
    sectionLabel?: string;
    present: number;
    absent: number;
    late: number;
    total: number;
  }>();

  for (const r of records) {
    const person = type === "STUDENT" ? r.student : r.teacher;
    if (!person) continue;
    const key = person.id;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        id: person.id,
        name: person.name,
        rollNo: type === "STUDENT" ? (r.student as any)?.rollNo : undefined,
        subject: type === "TEACHER" ? (r.teacher as any)?.subject : undefined,
        sectionLabel: type === "STUDENT"
          ? `${(r.student as any)?.section?.class?.name} - ${(r.student as any)?.section?.name}`
          : undefined,
        present: 0,
        absent: 0,
        late: 0,
        total: 0,
      });
    }
    const entry = summaryMap.get(key)!;
    entry.total++;
    if (r.status === "PRESENT") entry.present++;
    else if (r.status === "ABSENT") entry.absent++;
    else if (r.status === "LATE") entry.late++;
  }

  const summary = Array.from(summaryMap.values()).sort((a, b) => {
    if (a.rollNo && b.rollNo) return a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true });
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ summary, totalDays: new Set(records.map((r) => r.date.toISOString().split("T")[0])).size });
}
