import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function verify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  subject: z.string().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teachers = await prisma.teacher.findMany({
    where: { schoolId },
    orderBy: { name: "asc" },
    include: {
      mentorSection: { include: { class: { select: { name: true } } } },
      user: { select: { id: true } },
      invites: { where: { usedAt: null, expiresAt: { gt: new Date() } }, select: { token: true } },
    },
  });
  return NextResponse.json(teachers);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const teacher = await prisma.teacher.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        subject: data.subject || null,
        schoolId,
      },
    });

    let inviteToken: string | null = null;
    if (data.email) {
      const invite = await prisma.teacherInvite.create({
        data: {
          email: data.email,
          teacherId: teacher.id,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });
      inviteToken = invite.token;
    }

    return NextResponse.json({ ...teacher, inviteToken }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
