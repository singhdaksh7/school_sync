import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hasAccess = school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
  if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(school);
}

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school || school.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = updateSchema.parse(body);
    const updated = await prisma.school.update({
      where: { id: schoolId },
      data: { name: data.name, address: data.address || null, phone: data.phone || null, email: data.email || null, website: data.website || null },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
