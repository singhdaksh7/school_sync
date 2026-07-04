import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canInviteRole, isInvitableRole, sessionRole } from "@/lib/tenant";
import { sendStaffInviteEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { generateInviteToken } from "@/lib/invite-tokens";

function inviteBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  const requestBaseUrl = new URL(req.url).origin;
  return configuredBaseUrl || requestBaseUrl;
}

async function loadInvite(schoolId: string, inviteId: string) {
  const invite = await prisma.schoolInvite.findFirst({
    where: { id: inviteId, schoolId },
    include: { school: { select: { name: true } } },
  });
  return invite;
}

/** Resend: re-sends the invite email and pushes the expiry out another 7 days. */
export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; inviteId: string }> }) {
  const { schoolId, inviteId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invite = await loadInvite(schoolId, inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (!isInvitableRole(invite.role) || !(await canInviteRole(schoolId, session.user.id, invite.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (invite.usedAt) return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  // Rotate the token on resend: only the hash is stored, so the previous raw
  // token cannot be re-derived — a fresh one is minted (and the old link dies).
  const { rawToken, tokenHash } = generateInviteToken();
  const updated = await prisma.schoolInvite.update({ where: { id: inviteId }, data: { expiresAt, tokenHash } });

  const inviteLink = `${inviteBaseUrl(req)}/invite/${rawToken}`;
  let emailError: string | null = null;
  try {
    await sendStaffInviteEmail(updated.email, { name: updated.name ?? updated.email, role: updated.role, schoolName: invite.school.name, inviteLink });
  } catch (err) {
    console.error("Failed to resend staff invite email:", err);
    emailError = "Expiry extended, but the email could not be resent. Share the link manually.";
  }

  await logAudit({
    action: "INVITE_RESENT",
    entityType: "SchoolInvite",
    entityId: invite.id,
    metadata: { name: invite.name, email: invite.email, role: invite.role },
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ ...updated, inviteLink, emailError });
}

/** Cancel: revokes the invite outright -- the token becomes immediately invalid. */
export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; inviteId: string }> }) {
  const { schoolId, inviteId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invite = await loadInvite(schoolId, inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (!isInvitableRole(invite.role) || !(await canInviteRole(schoolId, session.user.id, invite.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (invite.usedAt) return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });

  await prisma.schoolInvite.delete({ where: { id: inviteId } });

  await logAudit({
    action: "INVITE_CANCELLED",
    entityType: "SchoolInvite",
    entityId: invite.id,
    metadata: { name: invite.name, email: invite.email, role: invite.role },
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}
