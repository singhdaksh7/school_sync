import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import DeletedTeachersClient from "./DeletedTeachersClient";

export default async function DeletedTeachersPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  // Server-rendered archival view (no pagination UI yet) — bounded to the
  // most recent 100 so this never grows into an unbounded page load.
  const teachers = await prisma.teacher.findMany({
    where: { schoolId: school.id, isDeleted: true },
    include: {
      deletedBy: { select: { id: true, name: true } },
    },
    orderBy: { deletedAt: "desc" },
    take: 100,
  });

  const snapshots = await prisma.auditLog.findMany({
    where: {
      schoolId: school.id,
      entityType: "Teacher",
      action: "TEACHER_SOFT_DELETED",
      entityId: { in: teachers.map((t) => t.id) },
    },
    orderBy: { createdAt: "desc" },
  });
  const snapshotByTeacherId = new Map<string, { classesHandled: string[]; sectionsHandled: string[] }>();
  for (const log of snapshots) {
    if (!log.entityId || snapshotByTeacherId.has(log.entityId)) continue;
    try {
      const parsed = log.metadata ? JSON.parse(log.metadata) : {};
      snapshotByTeacherId.set(log.entityId, {
        classesHandled: parsed.classesHandled ?? [],
        sectionsHandled: parsed.sectionsHandled ?? [],
      });
    } catch {
      snapshotByTeacherId.set(log.entityId, { classesHandled: [], sectionsHandled: [] });
    }
  }

  const teachersWithSnapshot = teachers.map((t) => ({
    ...t,
    classesHandled: snapshotByTeacherId.get(t.id)?.classesHandled ?? [],
    sectionsHandled: snapshotByTeacherId.get(t.id)?.sectionsHandled ?? [],
  }));

  return (
    <DeletedTeachersClient
      initialTeachers={teachersWithSnapshot}
      schoolId={school.id}
      schoolSlug={schoolSlug}
    />
  );
}
