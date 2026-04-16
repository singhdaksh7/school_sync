import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import TeachersClient from "./TeachersClient";

export default async function TeachersPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [teachers, classes] = await Promise.all([
    prisma.teacher.findMany({
      where: { schoolId: school.id },
      include: {
        mentorSection: { include: { class: true } },
        user: { select: { id: true } },
        invites: { select: { token: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <TeachersClient
      initialTeachers={teachers}
      initialClasses={classes}
      schoolId={school.id}
    />
  );
}
