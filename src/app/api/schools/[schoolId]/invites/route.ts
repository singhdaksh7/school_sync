import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function ownerOnly(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  return school?.ownerId === userId;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ownerOnly(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
  if (!(await ownerOnly(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, role } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const validRoles = ["SCHOOL_ADMIN", "VICE_PRINCIPAL"];
  const inviteRole = validRoles.includes(role) ? role : "SCHOOL_ADMIN";

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invite = await prisma.schoolInvite.create({
    data: { email, schoolId, invitedById: session.user.id, expiresAt, role: inviteRole as any },
  });

  const inviteLink = `${process.env.NEXTAUTH_URL}/invite/${invite.token}`;
  return NextResponse.json({ ...invite, inviteLink }, { status: 201 });
}
