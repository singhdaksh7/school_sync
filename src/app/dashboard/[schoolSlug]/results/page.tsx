import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import ResultsClient from "./ResultsClient";

export default async function ResultsPage({
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
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const sections = classes.flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, name: s.name, class: { name: c.name } }))
  );

  return <ResultsClient initialSchemes={schemes} initialSections={sections} schoolId={school.id} />;
}
