import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import ClassesClient from "./ClassesClient";

export default async function ClassesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const classes = await prisma.class.findMany({
    where: { schoolId: school.id },
    include: {
      sections: {
        include: { _count: { select: { students: true } } },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return <ClassesClient initialClasses={classes} schoolId={school.id} />;
}
