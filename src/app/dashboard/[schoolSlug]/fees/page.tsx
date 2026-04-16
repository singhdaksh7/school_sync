import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import FeesClient from "./FeesClient";

export default async function FeesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [structures, payments, students, classes] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { schoolId: school.id },
      include: { class: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.feePayment.findMany({
      where: { schoolId: school.id },
      include: {
        student: { include: { section: { include: { class: true } } } },
        feeStructure: { select: { name: true, amount: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { paidAt: "desc" },
    }),
    prisma.student.findMany({
      where: { schoolId: school.id },
      include: { section: { include: { class: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <FeesClient
      initialStructures={JSON.parse(JSON.stringify(structures))}
      initialPayments={JSON.parse(JSON.stringify(payments))}
      initialStudents={JSON.parse(JSON.stringify(students))}
      initialClasses={classes}
      schoolId={school.id}
    />
  );
}
