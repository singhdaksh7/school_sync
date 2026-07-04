import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Exam-milestone analytics is notebook-check completion data, so it belongs to
  // the NOTEBOOK_CHECKING module (its parent feature), NOT the ANALYTICS dashboard.
  {
    const denied = await requireSchoolFeature(schoolId, "NOTEBOOK_CHECKING");
    if (denied) return denied;
  }

  const milestones = await prisma.examMilestone.findMany({
    where: { schoolId, active: true },
    orderBy: { sequence: "asc" },
  });

  const milestoneStats = await Promise.all(
    milestones.map(async (milestone) => {
      const [totalRows, checkedRows] = await Promise.all([
        prisma.notebookCheck.count({ where: { schoolId, examMilestoneId: milestone.id } }),
        prisma.notebookCheck.count({ where: { schoolId, examMilestoneId: milestone.id, checked: true } }),
      ]);
      return {
        examMilestoneId: milestone.id,
        name: milestone.name,
        totalRows,
        checkedRows,
        percentage: totalRows > 0 ? Math.round((checkedRows / totalRows) * 10000) / 100 : null,
      };
    })
  );

  const studentsWithZeroChecks = await prisma.student.count({
    where: { schoolId, notebookChecks: { none: {} } },
  });
  const totalStudents = await prisma.student.count({ where: { schoolId } });

  return NextResponse.json({
    milestoneStats,
    studentsWithZeroChecks,
    totalStudents,
  });
}
