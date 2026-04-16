import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import ExamSchemesClient from "./ExamSchemesClient";

export default async function ExamSchemesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const schemes = await prisma.examScheme.findMany({
    where: { schoolId: school.id },
    include: { exams: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  return <ExamSchemesClient initialSchemes={schemes} schoolId={school.id} />;
}
