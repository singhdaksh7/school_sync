import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.teacherInvite.findUnique({
    where: { token },
    include: { teacher: { select: { name: true, school: { select: { name: true } } } } },
  });

  if (!invite) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "Invite already used" }, { status: 400 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "Invite has expired" }, { status: 400 });

  return NextResponse.json({
    email: invite.email,
    name: invite.teacher.name,
    school: invite.teacher.school.name,
  });
}

const schema = z.object({ password: z.string().min(6) });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.teacherInvite.findUnique({
    where: { token },
    include: { teacher: true },
  });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
  }

  // Check teacher doesn't already have an account
  if (invite.teacher.userId) {
    return NextResponse.json({ error: "Account already created for this teacher" }, { status: 400 });
  }

  try {
    const { password } = schema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: invite.teacher.name,
        email: invite.email,
        password: hashed,
        role: "TEACHER",
      },
    });

    await prisma.teacher.update({
      where: { id: invite.teacherId },
      data: { userId: user.id },
    });

    await prisma.teacherInvite.update({ where: { token }, data: { usedAt: new Date() } });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
