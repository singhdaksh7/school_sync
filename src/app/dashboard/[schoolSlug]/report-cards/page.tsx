import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import ReportCardsClient from "./ReportCardsClient";

export default async function ReportCardsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [classes, schemes] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.examScheme.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sections = classes.flatMap((cls) =>
    cls.sections.map((section) => ({
      id: section.id,
      name: section.name,
      className: cls.name,
    }))
  );

  return <ReportCardsClient schoolId={school.id} sections={sections} schemes={schemes} />;
}
