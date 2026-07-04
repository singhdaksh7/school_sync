import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canWriteSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { isValidPermission } from "@/lib/teacher-permissions";

const permissionSchema = z.object({
  module: z.string().min(1),
  action: z.string().min(1),
  allowed: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(280).optional().or(z.literal("")),
  // When provided, the permission set is fully replaced.
  permissions: z.array(permissionSchema).optional(),
});

async function roleInSchool(roleId: string, schoolId: string) {
  return prisma.teacherCustomRole.findFirst({ where: { id: roleId, schoolId }, select: { id: true } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; roleId: string }> }
) {
  const { schoolId, roleId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user))))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }
  if (!(await roleInSchool(roleId, schoolId)))
    return NextResponse.json({ error: "Role not found" }, { status: 404 });

  try {
    const data = updateSchema.parse(await req.json());

    if (data.permissions) {
      const invalid = data.permissions.find((p) => !isValidPermission(p.module, p.action));
      if (invalid)
        return NextResponse.json(
          { error: `Unknown permission ${invalid.module}:${invalid.action}` },
          { status: 400 }
        );
    }

    const role = await prisma.$transaction(async (tx) => {
      await tx.teacherCustomRole.update({
        where: { id: roleId },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        },
      });

      if (data.permissions) {
        const unique = new Map(data.permissions.map((p) => [`${p.module}:${p.action}`, p]));
        await tx.teacherPermission.deleteMany({ where: { roleId } });
        if (unique.size > 0) {
          await tx.teacherPermission.createMany({
            data: Array.from(unique.values()).map((p) => ({
              roleId,
              module: p.module,
              action: p.action,
              allowed: p.allowed,
            })),
          });
        }
      }

      return tx.teacherCustomRole.findUnique({
        where: { id: roleId },
        include: { permissions: true, _count: { select: { assignments: true } } },
      });
    });

    return NextResponse.json({ role });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if ((err as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
    console.error("Update teacher role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; roleId: string }> }
) {
  const { schoolId, roleId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user))))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }
  if (!(await roleInSchool(roleId, schoolId)))
    return NextResponse.json({ error: "Role not found" }, { status: 404 });

  // Cascade removes permissions + assignments.
  await prisma.teacherCustomRole.delete({ where: { id: roleId } });
  return NextResponse.json({ success: true });
}
