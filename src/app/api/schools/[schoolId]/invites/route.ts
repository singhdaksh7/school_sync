import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school || school.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const invites = await prisma.schoolInvite.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invites);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school || school.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

  const invite = await prisma.schoolInvite.create({
    data: { email, schoolId, invitedById: session.user.id, expiresAt },
  });

  // In production, send email here. For now, return the invite link.
  const inviteLink = `${process.env.NEXTAUTH_URL}/invite/${invite.token}`;
  return NextResponse.json({ ...invite, inviteLink }, { status: 201 });
}
