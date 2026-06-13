import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { getTeacherAssignments, homeworkIncludeForList } from "@/lib/homework";
import HomeworkClient from "./HomeworkClient";

export default async function HomeworkPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [homework, classes, teachers] = await Promise.all([
    prisma.homework.findMany({
      where: { schoolId: school.id },
      include: homeworkIncludeForList(),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const assignmentsByTeacher = await Promise.all(
    teachers.map(async (teacher) => ({
      teacherId: teacher.id,
      teacherName: teacher.name,
      assignments: await getTeacherAssignments(teacher.id, school.id),
    }))
  );

  return (
    <HomeworkClient
      schoolId={school.id}
      initialHomework={JSON.parse(JSON.stringify(homework))}
      initialClasses={JSON.parse(JSON.stringify(classes))}
      initialTeachers={teachers}
      initialAssignmentsByTeacher={assignmentsByTeacher}
    />
  );
}
