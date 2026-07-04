import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { generateInviteToken } from "@/lib/invite-tokens";

/**
 * Regenerates a teacher's invite link. Needed because invite tokens are stored
 * hashed — the raw token from creation cannot be re-displayed, so the admin
 * mints a fresh one here. Rotating also invalidates any previous outstanding
 * link for this teacher.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId, isDeleted: false },
    select: { id: true, email: true, userId: true },
  });
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  if (teacher.userId) return NextResponse.json({ error: "This teacher already has an account" }, { status: 400 });
  if (!teacher.email) return NextResponse.json({ error: "Teacher has no email to invite" }, { status: 400 });

  const { rawToken, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Replace any outstanding unused invites for this teacher with the fresh one.
  await prisma.$transaction([
    prisma.teacherInvite.deleteMany({ where: { teacherId, usedAt: null } }),
    prisma.teacherInvite.create({ data: { email: teacher.email, teacherId, expiresAt, tokenHash } }),
  ]);

  return NextResponse.json({ inviteToken: rawToken });
}
