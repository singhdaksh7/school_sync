import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { PERMISSION_CATALOG } from "@/lib/teacher-permissions";
import TeacherRolesClient from "./TeacherRolesClient";

export default async function TeacherRolesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [roles, teachers, classes] = await Promise.all([
    prisma.teacherCustomRole.findMany({
      where: { schoolId: school.id },
      include: {
        permissions: { orderBy: [{ module: "asc" }, { action: "asc" }] },
        _count: { select: { assignments: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { schoolId: school.id, isDeleted: false },
      select: {
        id: true,
        name: true,
        roleAssignments: {
          select: { id: true, role: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const initialRoles = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    assignmentCount: role._count.assignments,
    permissions: role.permissions.map((p) => ({ module: p.module, action: p.action, allowed: p.allowed })),
  }));

  const initialTeachers = teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    assignments: teacher.roleAssignments.map((a) => ({ id: a.id, role: a.role })),
  }));

  const initialClasses = classes.map((cls) => ({
    id: cls.id,
    name: cls.name,
    sections: cls.sections.map((s) => ({ id: s.id, name: s.name })),
  }));

  return (
    <TeacherRolesClient
      schoolId={school.id}
      catalog={PERMISSION_CATALOG as Record<string, readonly string[]>}
      initialRoles={initialRoles}
      initialTeachers={initialTeachers}
      initialClasses={initialClasses}
    />
  );
}
