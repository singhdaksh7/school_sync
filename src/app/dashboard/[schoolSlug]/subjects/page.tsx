import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import SubjectMasterClient from "./SubjectMasterClient";

export default async function SubjectsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const classes = await prisma.class.findMany({
    where: { schoolId: school.id },
    include: { sections: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return <SubjectMasterClient schoolId={school.id} classes={classes} />;
}
