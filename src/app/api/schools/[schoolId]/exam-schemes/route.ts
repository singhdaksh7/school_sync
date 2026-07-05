import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

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
  const role = sessionRole(session.user);
  const userSchoolId = (session.user as { schoolId?: unknown }).schoolId;
  const isTeacherOfSchool = role === "TEACHER" && userSchoolId === schoolId;

  if (!isTeacherOfSchool && !(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: isTeacherOfSchool ? "TEACHER" : "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
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
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

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
