import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import StudentProfileClient from "./StudentProfileClient";
import { notFound } from "next/navigation";

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ schoolSlug: string; studentId: string }>;
}) {
  const { schoolSlug, studentId } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [student, classes, transfers] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, schoolId: school.id },
      include: {
        section: { include: { class: true } },
        attendances: { orderBy: { date: "desc" }, take: 60 },
        examResults: {
          include: { exam: { include: { scheme: { select: { id: true, name: true } } } } },
        },
      },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.sectionTransfer.findMany({
      where: { studentId },
      include: {
        fromSection: { include: { class: { select: { name: true } } } },
        toSection: { include: { class: { select: { name: true } } } },
        transferredBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!student) notFound();

  return (
    <StudentProfileClient
      initialStudent={JSON.parse(JSON.stringify(student))}
      initialClasses={classes}
      initialTransfers={JSON.parse(JSON.stringify(transfers))}
      schoolId={school.id}
      schoolSlug={schoolSlug}
    />
  );
}
