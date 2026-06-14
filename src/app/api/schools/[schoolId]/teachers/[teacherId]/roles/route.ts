import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canAccessSchool, canWriteSchool, teacherBelongsToSchool } from "@/lib/tenant";

const assignSchema = z.object({
  roleId: z.string().min(1),
  classIds: z.array(z.string()).optional().default([]),
  sectionIds: z.array(z.string()).optional().default([]),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; teacherId: string }> }
) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await teacherBelongsToSchool(teacherId, schoolId)))
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const assignments = await prisma.teacherRoleAssignment.findMany({
    where: { teacherId, schoolId },
    include: { role: { include: { permissions: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assignments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; teacherId: string }> }
) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user))))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await teacherBelongsToSchool(teacherId, schoolId)))
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  try {
    const data = assignSchema.parse(await req.json());

    const role = await prisma.teacherCustomRole.findFirst({
      where: { id: data.roleId, schoolId },
      select: { id: true },
    });
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

    // All scoped classes/sections must belong to this school (no cross-school scope).
    const classIds = [...new Set(data.classIds)];
    const sectionIds = [...new Set(data.sectionIds)];
    if (classIds.length > 0) {
      const count = await prisma.class.count({ where: { id: { in: classIds }, schoolId } });
      if (count !== classIds.length)
        return NextResponse.json({ error: "One or more classes are invalid." }, { status: 400 });
    }
    if (sectionIds.length > 0) {
      const count = await prisma.section.count({ where: { id: { in: sectionIds }, class: { schoolId } } });
      if (count !== sectionIds.length)
        return NextResponse.json({ error: "One or more sections are invalid." }, { status: 400 });
    }

    // Upsert keeps the unique (teacherId, roleId) pair and lets admins re-scope.
    const assignment = await prisma.teacherRoleAssignment.upsert({
      where: { teacherId_roleId: { teacherId, roleId: data.roleId } },
      create: {
        teacherId,
        roleId: data.roleId,
        schoolId,
        classIds: classIds.length ? classIds : undefined,
        sectionIds: sectionIds.length ? sectionIds : undefined,
      },
      update: {
        classIds: classIds.length ? classIds : undefined,
        sectionIds: sectionIds.length ? sectionIds : undefined,
      },
      include: { role: { include: { permissions: true } } },
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Assign teacher role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
