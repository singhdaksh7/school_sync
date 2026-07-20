import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sectionBelongsToSchool, studentBelongsToSchool } from "@/lib/tenant";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { parsePagination, paginated } from "@/lib/pagination";
import { requireSchoolFeature } from "@/lib/feature-flags";

/** Read-only, append-only history viewer — never exposes an update/delete path (see AttendanceHistory model docstring). */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "VIEW", "ATTENDANCE_CORRECTION_VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const studentId = searchParams.get("studentId");
  const date = searchParams.get("date");

  if (sectionId && !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }
  if (studentId && !(await studentBelongsToSchool(studentId, schoolId))) {
    return NextResponse.json({ error: "Student not found in this school" }, { status: 400 });
  }

  const { skip, take, page, limit } = parsePagination(searchParams);
  const where = {
    schoolId,
    ...(sectionId ? { sectionId } : {}),
    ...(studentId ? { studentId } : {}),
    ...(date ? { date: new Date(date + "T00:00:00.000Z") } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.attendanceHistory.findMany({
      where,
      include: { student: { select: { name: true, rollNo: true } } },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.attendanceHistory.count({ where }),
  ]);

  return NextResponse.json(paginated(entries, total, { skip, take, page, limit }));
}
