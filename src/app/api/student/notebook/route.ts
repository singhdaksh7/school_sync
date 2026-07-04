import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getActiveExamMilestones } from "@/lib/homework";

export async function GET(req: NextRequest) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.schoolId, "NOTEBOOK_CHECKING");
  if (featureDenied) return featureDenied;

  const milestones = await getActiveExamMilestones(auth.schoolId);
  const checks = await prisma.notebookCheck.findMany({
    where: { schoolId: auth.schoolId, studentId: auth.studentId },
  });

  const subjects = Array.from(new Set(checks.map((c) => c.subject))).sort();
  const checksByKey = new Map(checks.map((c) => [`${c.subject}|${c.examMilestoneId}`, c]));

  let totalCells = 0;
  let totalChecked = 0;

  const subjectGrid = subjects.map((subject) => {
    const milestoneStatuses = milestones.map((milestone) => {
      const check = checksByKey.get(`${subject}|${milestone.id}`);
      const checked = check?.checked ?? false;
      totalCells += 1;
      if (checked) totalChecked += 1;
      return {
        examMilestoneId: milestone.id,
        name: milestone.name,
        checked,
        checkedAt: check?.checkedAt ?? null,
      };
    });
    const subjectChecked = milestoneStatuses.filter((m) => m.checked).length;
    return {
      subject,
      milestones: milestoneStatuses,
      checkedCount: subjectChecked,
      totalCount: milestones.length,
      percentage: milestones.length > 0 ? Math.round((subjectChecked / milestones.length) * 10000) / 100 : null,
    };
  });

  return NextResponse.json({
    subjects: subjectGrid,
    overallCheckedCount: totalChecked,
    overallTotalCount: totalCells,
    overallPercentage: totalCells > 0 ? Math.round((totalChecked / totalCells) * 10000) / 100 : null,
  });
}
