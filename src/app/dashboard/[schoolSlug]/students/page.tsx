import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import StudentsClient from "./StudentsClient";

export default async function StudentsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [students, classes] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId: school.id },
      include: { section: { include: { class: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const sections = classes.flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, name: s.name, class: { id: c.id, name: c.name } }))
  );

  return (
    <StudentsClient
      initialStudents={students}
      initialSections={sections}
      schoolId={school.id}
      schoolSlug={schoolSlug}
    />
  );
}
