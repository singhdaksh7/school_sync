import { getSchoolBySlug } from "@/lib/school";
import { ensureDefaultExamMilestonesSeeded } from "@/lib/homework";
import { prisma } from "@/lib/prisma";
import ExamMilestonesClient from "./ExamMilestonesClient";

export default async function ExamMilestonesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  await ensureDefaultExamMilestonesSeeded(school.id);
  const milestones = await prisma.examMilestone.findMany({
    where: { schoolId: school.id },
    orderBy: { sequence: "asc" },
  });

  return <ExamMilestonesClient initialMilestones={milestones} schoolId={school.id} />;
}
