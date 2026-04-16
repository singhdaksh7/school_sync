import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const classes = await prisma.class.findMany({
    where: { schoolId: school.id },
    include: { sections: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const sections = classes.flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, name: s.name, class: { name: c.name } }))
  );

  return <ReportsClient initialSections={sections} schoolId={school.id} />;
}
