import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function canView(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

async function canWrite(schoolId: string, userId: string, role: string) {
  if (role === "VICE_PRINCIPAL") return false;
  return canView(schoolId, userId);
}

const schemeSchema = z.object({
  name: z.string().min(2),
  exams: z.array(z.object({
    name: z.string().min(1),
    maxMarks: z.number().int().positive(),
    order: z.number().int().default(0),
  })),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Teachers of this school can read exam schemes
  const role = (session.user as any).role as string;
  const userSchoolId = (session.user as any).schoolId as string;
  const isTeacherOfSchool = role === "TEACHER" && userSchoolId === schoolId;

  if (!isTeacherOfSchool && !(await canView(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schemes = await prisma.examScheme.findMany({
    where: { schoolId },
    include: { exams: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(schemes);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role as string;
  if (!(await canWrite(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schemeSchema.parse(await req.json());
    const scheme = await prisma.examScheme.create({
      data: {
        name: body.name,
        schoolId,
        exams: {
          create: body.exams.map((e, i) => ({ name: e.name, maxMarks: e.maxMarks, order: e.order || i })),
        },
      },
      include: { exams: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json(scheme, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Scheme name already exists" }, { status: 400 });
  }
}
