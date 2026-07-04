import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendStaffInviteEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

function inviteBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  const requestBaseUrl = new URL(req.url).origin;
  return configuredBaseUrl || requestBaseUrl;
}

export async function GET() {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const invites = await prisma.schoolInvite.findMany({
    where: { invitedBy: { role: "FOUNDER" } },
    include: {
      school: { select: { id: true, name: true, slug: true } },
      plan: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invites);
}

const createSchema = z.object({
  schoolId: z.string().min(1),
  name: z.string().min(2),
  email: z.string().email(),
  planId: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = createSchema.parse(await req.json());

    const [school, plan] = await Promise.all([
      prisma.school.findUnique({ where: { id: body.schoolId }, select: { id: true, name: true } }),
      prisma.subscriptionPlan.findUnique({ where: { id: body.planId } }),
    ]);
    if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const isTrial = plan.slug === "trial" || plan.name.toLowerCase() === "trial";
    const trialStartDate = isTrial ? new Date() : null;
    const trialExpiryDate = isTrial ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await prisma.schoolInvite.create({
      data: {
        name: body.name,
        email: body.email,
        role: "SCHOOL_ADMIN",
        schoolId: body.schoolId,
        invitedById: session.user.id,
        expiresAt,
        planId: plan.id,
        billingCycle: "MONTHLY",
        trialStartDate,
        trialExpiryDate,
      },
    });

    const inviteLink = `${inviteBaseUrl(req)}/invite/${invite.token}`;

    let emailError: string | null = null;
    try {
      await sendStaffInviteEmail(invite.email, {
        name: invite.name ?? invite.email,
        role: "SCHOOL_ADMIN",
        schoolName: school.name,
        inviteLink,
      });
    } catch (err) {
      console.error("Failed to send founder admin invite email:", err);
      emailError = "Invite created, but the email could not be sent. Share the link manually.";
    }

    await logAudit({
      action: "FOUNDER_INVITE_CREATED",
      entityType: "SchoolInvite",
      entityId: invite.id,
      metadata: { name: invite.name, email: invite.email, planId: plan.id },
      userId: session.user.id,
      schoolId: school.id,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ ...invite, inviteLink, emailError }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Create founder invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
