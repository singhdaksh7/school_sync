import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { sendStaffInviteEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

function inviteBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  const requestBaseUrl = new URL(req.url).origin;
  return configuredBaseUrl || requestBaseUrl;
}

async function loadFounderInvite(inviteId: string) {
  return prisma.schoolInvite.findFirst({
    where: { id: inviteId, invitedBy: { role: "FOUNDER" } },
    include: { school: { select: { id: true, name: true } } },
  });
}

/** Resend: re-sends the invite email and pushes the expiry out another 7 days. */
export async function PATCH(req: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { inviteId } = await params;
  const invite = await loadFounderInvite(inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  const updated = await prisma.schoolInvite.update({ where: { id: inviteId }, data: { expiresAt } });

  const inviteLink = `${inviteBaseUrl(req)}/invite/${updated.token}`;
  let emailError: string | null = null;
  try {
    await sendStaffInviteEmail(updated.email, {
      name: updated.name ?? updated.email,
      role: "SCHOOL_ADMIN",
      schoolName: invite.school.name,
      inviteLink,
    });
  } catch (err) {
    console.error("Failed to resend founder admin invite email:", err);
    emailError = "Expiry extended, but the email could not be resent. Share the link manually.";
  }

  await logAudit({
    action: "FOUNDER_INVITE_RESENT",
    entityType: "SchoolInvite",
    entityId: invite.id,
    metadata: { name: invite.name, email: invite.email },
    userId: session.user.id,
    schoolId: invite.school.id,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ ...updated, inviteLink, emailError });
}

/** Cancel: revokes the invite outright -- the token becomes immediately invalid. */
export async function DELETE(req: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { inviteId } = await params;
  const invite = await loadFounderInvite(inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });

  await prisma.schoolInvite.delete({ where: { id: inviteId } });

  await logAudit({
    action: "FOUNDER_INVITE_CANCELLED",
    entityType: "SchoolInvite",
    entityId: invite.id,
    metadata: { name: invite.name, email: invite.email },
    userId: session.user.id,
    schoolId: invite.school.id,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}
