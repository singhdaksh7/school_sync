import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canAccessSchool, canWriteSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { isValidPermission } from "@/lib/teacher-permissions";

const permissionSchema = z.object({
  module: z.string().min(1),
  action: z.string().min(1),
  allowed: z.boolean().optional().default(true),
});

const createSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(280).optional().or(z.literal("")),
  permissions: z.array(permissionSchema).default([]),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }

  const roles = await prisma.teacherCustomRole.findMany({
    where: { schoolId },
    include: {
      permissions: { orderBy: [{ module: "asc" }, { action: "asc" }] },
      _count: { select: { assignments: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ roles });
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user))))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "TEACHER_PERMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = createSchema.parse(await req.json());

    const invalid = data.permissions.find((p) => !isValidPermission(p.module, p.action));
    if (invalid)
      return NextResponse.json(
        { error: `Unknown permission ${invalid.module}:${invalid.action}` },
        { status: 400 }
      );

    // Dedupe by module:action so the @@unique([roleId, module, action]) holds.
    const unique = new Map(data.permissions.map((p) => [`${p.module}:${p.action}`, p]));

    const role = await prisma.teacherCustomRole.create({
      data: {
        schoolId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        permissions: {
          create: Array.from(unique.values()).map((p) => ({
            module: p.module,
            action: p.action,
            allowed: p.allowed,
          })),
        },
      },
      include: { permissions: true, _count: { select: { assignments: true } } },
    });

    return NextResponse.json({ role }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if ((err as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
    console.error("Create teacher role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
