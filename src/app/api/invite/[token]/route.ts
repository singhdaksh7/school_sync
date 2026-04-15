import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.schoolInvite.findUnique({
    where: { token },
    include: { school: { select: { name: true, slug: true } } },
  });

  if (!invite) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "Invite already used" }, { status: 400 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "Invite has expired" }, { status: 400 });

  return NextResponse.json({ email: invite.email, role: invite.role, school: invite.school });
}

const acceptSchema = z.object({
  name: z.string().min(2),
  password: z.string().min(6),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.schoolInvite.findUnique({
    where: { token },
    include: { school: true },
  });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { name, password } = acceptSchema.parse(body);

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { schoolId: invite.schoolId, role: invite.role },
      });
    } else {
      const hashed = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          name,
          email: invite.email,
          password: hashed,
          role: invite.role,
          schoolId: invite.schoolId,
        },
      });
    }

    await prisma.schoolInvite.update({ where: { token }, data: { usedAt: new Date() } });

    return NextResponse.json({ schoolSlug: invite.school.slug });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
