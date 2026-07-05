import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { generateInviteToken } from "@/lib/invite-tokens";
import { parsePagination, paginated } from "@/lib/pagination";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

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
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  // Teacher dropdowns/assignment flows need the whole roster, so the ceiling
  // is generous (staff counts are inherently far smaller than student counts).
  const { skip, take, page, limit } = parsePagination(searchParams, { maxLimit: 500 });
  const where = { schoolId, isDeleted: false };
  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        mentorSection: { include: { class: { select: { name: true } } } },
        user: { select: { id: true } },
        invites: { where: { usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
      },
      skip,
      take,
    }),
    prisma.teacher.count({ where }),
  ]);
  return NextResponse.json(paginated(teachers, total, { skip, take, page, limit }));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

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
      const { rawToken, tokenHash } = generateInviteToken();
      await prisma.teacherInvite.create({
        data: {
          email: data.email,
          teacherId: teacher.id,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          tokenHash,
        },
      });
      // Returned once; only the hash is stored, so this raw token cannot be
      // re-displayed later — the admin regenerates a fresh link if lost.
      inviteToken = rawToken;
    }

    return NextResponse.json({ ...teacher, inviteToken }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
