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

  const [schemes, classes] = await Promise.all([
    prisma.examScheme.findMany({
      where: { schoolId: school.id },
      include: { exams: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return <ExamSchemesClient initialSchemes={schemes} schoolId={school.id} initialClasses={classes} />;
}
