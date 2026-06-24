import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canInviteRole, isInvitableRole, sessionRole } from "@/lib/tenant";
import { sendStaffInviteEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.string(),
});

function inviteBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  const requestBaseUrl = new URL(req.url).origin;
  return configuredBaseUrl || requestBaseUrl;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Any of the three invitable roles works here -- this is a read, the real
  // per-role gating happens on create/resend/cancel.
  if (!(await canInviteRole(schoolId, session.user.id, "TEACHER"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await prisma.schoolInvite.findMany({
    where: { schoolId },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invites);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = createSchema.parse(await req.json());
    if (!isInvitableRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!(await canInviteRole(schoolId, session.user.id, body.role))) {
      return NextResponse.json({ error: "You don't have permission to invite this role" }, { status: 403 });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });
    if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await prisma.schoolInvite.create({
      data: { name: body.name, email: body.email, schoolId, invitedById: session.user.id, expiresAt, role: body.role },
    });

    const inviteLink = `${inviteBaseUrl(req)}/invite/${invite.token}`;

    let emailError: string | null = null;
    try {
      await sendStaffInviteEmail(invite.email, { name: invite.name ?? invite.email, role: invite.role, schoolName: school.name, inviteLink });
    } catch (err) {
      console.error("Failed to send staff invite email:", err);
      emailError = "Invite created, but the email could not be sent. Share the link manually.";
    }

    await logAudit({
      action: "INVITE_CREATED",
      entityType: "SchoolInvite",
      entityId: invite.id,
      metadata: { name: invite.name, email: invite.email, role: invite.role },
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ ...invite, inviteLink, emailError }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Create invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
