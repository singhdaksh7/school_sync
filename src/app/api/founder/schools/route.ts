import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isSchoolPaymentOverdue } from "@/lib/payment-overdue";
import { createSchoolWithAdminSchema, createSchoolWithAdmin } from "@/lib/school-onboarding";
import { sendStaffInviteEmail } from "@/lib/email";
import { createNotification } from "@/lib/founder-notifications";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

const PAGE_SIZE = 10;
const VALID_STATUSES = ["ACTIVE", "TRIAL", "EXPIRED", "SUSPENDED"] as const;

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const status = searchParams.get("status")?.trim().toUpperCase() || "";
  const planId = searchParams.get("planId")?.trim() || "";
  const billing = searchParams.get("billing")?.trim().toLowerCase() || "";
  const from = searchParams.get("from")?.trim() || "";
  const to = searchParams.get("to")?.trim() || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const where: Prisma.SchoolWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }
  if (VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status as (typeof VALID_STATUSES)[number];
  }
  if (planId) {
    where.subscription = { planId };
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }

  const select = {
    id: true,
    name: true,
    slug: true,
    status: true,
    createdAt: true,
    _count: { select: { students: true, teachers: true, guardians: true, admins: true } },
    subscription: {
      select: {
        billingCycle: true,
        amount: true,
        currentPeriodEnd: true,
        plan: { select: { name: true } },
      },
    },
  } as const;

  async function withOverdueFlag(schools: Prisma.SchoolGetPayload<{ select: typeof select }>[]) {
    const schoolIds = schools.map((s) => s.id);
    const submissions = schoolIds.length
      ? await prisma.paymentProofSubmission.findMany({
          where: { schoolId: { in: schoolIds } },
          select: { schoolId: true, status: true, billingMonth: true },
        })
      : [];
    const submissionsBySchool = new Map<string, typeof submissions>();
    for (const s of submissions) {
      submissionsBySchool.set(s.schoolId, [...(submissionsBySchool.get(s.schoolId) ?? []), s]);
    }
    return schools.map((school) => ({
      ...school,
      isOverdue: isSchoolPaymentOverdue(school.subscription, submissionsBySchool.get(school.id) ?? []),
    }));
  }

  // Billing status depends on a derived (non-DB) flag, so when it's requested
  // we fetch every matching school, filter in JS, then paginate in JS too.
  // The common path (no billing filter) stays fully DB-paginated.
  if (billing === "overdue" || billing === "current") {
    const allMatching = await prisma.school.findMany({ where, orderBy: { createdAt: "desc" }, select });
    const withFlag = await withOverdueFlag(allMatching);
    const filtered = withFlag.filter((s) => (billing === "overdue" ? s.isOverdue : !s.isOverdue));
    const total = filtered.length;
    const start = (page - 1) * PAGE_SIZE;
    const schools = filtered.slice(start, start + PAGE_SIZE);

    return NextResponse.json({
      schools,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  }

  const [schools, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select,
    }),
    prisma.school.count({ where }),
  ]);

  const schoolsWithOverdue = await withOverdueFlag(schools);

  return NextResponse.json({
    schools: schoolsWithOverdue,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

function inviteBaseUrl(req: Request) {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  const requestBaseUrl = new URL(req.url).origin;
  return configuredBaseUrl || requestBaseUrl;
}

/**
 * The integrated Founder "Add School" transaction: school + subscription +
 * initial admin invite, created atomically and idempotently by
 * src/lib/school-onboarding.ts. The email send/notification/audit calls
 * happen HERE (not in the lib helper) — sendStaffInviteEmail call sites must
 * live under src/app only (see tests/email-iam-mapping.test.ts): only the
 * web ECS task role has SES permission.
 */
export async function POST(req: Request) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchoolWithAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const result = await createSchoolWithAdmin(parsed.data, session.user.id);
  if (!result.ok) {
    const status = result.code === "VALIDATION" ? 400 : 404;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  const { school, invite, plan, deduplicated, rawInviteToken } = result;
  let inviteLink: string | null = null;
  let emailError: string | null = null;

  if (rawInviteToken) {
    inviteLink = `${inviteBaseUrl(req)}/invite/${rawInviteToken}`;
    try {
      await sendStaffInviteEmail(invite.email, {
        name: invite.name ?? invite.email,
        role: "SCHOOL_ADMIN",
        schoolName: school.name,
        inviteLink,
      });
    } catch (err) {
      console.error("Failed to send Add-School admin invite email:", err);
      emailError = "School created, but the invite email could not be sent. Share the link manually or resend it from the school's page.";
    }

    await createNotification({
      type: "SCHOOL_REGISTERED",
      title: "New school registered",
      message: `${school.name} was created by the Founder.`,
      schoolId: school.id,
    });

    const ipAddress = getClientIp(req);
    await logAudit({
      action: "SCHOOL_CREATED",
      entityType: "School",
      entityId: school.id,
      metadata: { name: school.name, planId: plan.id },
      userId: session.user.id,
      schoolId: school.id,
      ipAddress,
    });
    await logAudit({
      action: "FOUNDER_INVITE_CREATED",
      entityType: "SchoolInvite",
      entityId: invite.id,
      metadata: { name: invite.name, email: invite.email, planId: plan.id },
      userId: session.user.id,
      schoolId: school.id,
      ipAddress,
    });
  }

  return NextResponse.json(
    {
      school,
      invite: { id: invite?.id, email: invite?.email },
      inviteLink,
      emailError,
      deduplicated,
    },
    { status: deduplicated ? 200 : 201 }
  );
}
