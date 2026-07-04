import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.schoolInvite.findUnique({
    where: { token },
    include: { school: { select: { name: true, slug: true } }, invitedBy: { select: { name: true, email: true } } },
  });

  if (!invite) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (invite.usedAt) {
    return NextResponse.json({ error: "Invite already used", contact: invite.invitedBy }, { status: 400 });
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This invitation link has expired. Please contact your school administrator.", contact: invite.invitedBy },
      { status: 400 }
    );
  }

  return NextResponse.json({ name: invite.name, email: invite.email, role: invite.role, school: invite.school });
}

const acceptSchema = z
  .object({
    name: z.string().min(2),
    password: z.string().min(6),
    confirmPassword: z.string().min(6),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.schoolInvite.findUnique({
    where: { token },
    include: { school: true, invitedBy: { select: { role: true } }, plan: true },
  });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { name, password } = acceptSchema.parse(body);

    // An invite is the only path that may grant a staff role -- if this email
    // already belongs to a non-staff account (Founder, Student, ...), never
    // silently repurpose it. Re-accepting after losing staff access is fine.
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    const STAFF_ROLES = new Set(["SCHOOL_ADMIN", "VICE_PRINCIPAL", "TEACHER"]);
    if (existing && !STAFF_ROLES.has(existing.role)) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 400 });
    }

    let userId!: string;
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.user.update({
          where: { id: existing.id },
          data: { schoolId: invite.schoolId, role: invite.role },
        });
        userId = existing.id;
      } else {
        const hashed = await bcrypt.hash(password, 12);
        const user = await tx.user.create({
          data: {
            name,
            email: invite.email,
            password: hashed,
            role: invite.role,
            schoolId: invite.schoolId,
          },
        });
        userId = user.id;
      }

      // TEACHER accounts need a linked Teacher profile for the rest of the app
      // (mentor sections, timetable, homework, etc.) to work at all.
      if (invite.role === "TEACHER") {
        const existingTeacher = await tx.teacher.findUnique({ where: { userId } });
        if (!existingTeacher) {
          await tx.teacher.create({
            data: { name, schoolId: invite.schoolId, userId },
          });
        }
      }

      // Founder-issued invites additionally provision ownership and a
      // subscription -- school-internal staff invites (invitedBy a
      // SCHOOL_OWNER/SCHOOL_ADMIN) never touch any of this.
      if (invite.invitedBy.role === "FOUNDER") {
        if (!invite.school.ownerId) {
          await tx.user.update({ where: { id: userId }, data: { role: "SCHOOL_OWNER" } });
          await tx.school.update({ where: { id: invite.schoolId }, data: { ownerId: userId } });
        }

        if (invite.planId && invite.plan) {
          const amount = invite.billingCycle === "ANNUAL" ? invite.plan.priceAnnual : invite.plan.priceMonthly;
          await tx.schoolSubscription.upsert({
            where: { schoolId: invite.schoolId },
            create: {
              schoolId: invite.schoolId,
              planId: invite.planId,
              billingCycle: invite.billingCycle ?? "MONTHLY",
              amount,
              currentPeriodEnd: invite.trialExpiryDate,
            },
            update: {
              planId: invite.planId,
              billingCycle: invite.billingCycle ?? "MONTHLY",
              amount,
              currentPeriodEnd: invite.trialExpiryDate,
            },
          });
        }

        await tx.school.update({
          where: { id: invite.schoolId },
          data: { status: invite.trialExpiryDate ? "TRIAL" : "ACTIVE" },
        });
      }

      await tx.schoolInvite.update({ where: { token }, data: { usedAt: new Date() } });
    });

    await logAudit({
      action: "INVITE_ACCEPTED",
      entityType: "SchoolInvite",
      entityId: invite.id,
      metadata: { email: invite.email, role: invite.role },
      userId: userId!,
      schoolId: invite.schoolId,
      actorRole: invite.role,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ schoolSlug: invite.school.slug });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Accept invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
