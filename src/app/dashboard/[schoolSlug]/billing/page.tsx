import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { isSchoolPaymentOverdue } from "@/lib/payment-overdue";
import BillingClient from "./BillingClient";

export default async function SchoolBillingPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const role = sessionRole(session.user) ?? "";
  if (role !== "SCHOOL_OWNER" && role !== "SCHOOL_ADMIN") {
    redirect(`/dashboard/${schoolSlug}`);
  }

  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [subscription, submissionsForOverdue] = await Promise.all([
    prisma.schoolSubscription.findUnique({
      where: { schoolId: school.id },
      include: { plan: true },
    }),
    prisma.paymentProofSubmission.findMany({
      where: { schoolId: school.id },
      select: { status: true, billingMonth: true },
    }),
  ]);

  const isOverdue = isSchoolPaymentOverdue(subscription, submissionsForOverdue);

  return (
    <BillingClient
      schoolId={school.id}
      status={school.status}
      isOverdue={isOverdue}
      subscription={
        subscription
          ? {
              planName: subscription.plan.name,
              billingCycle: subscription.billingCycle,
              amount: subscription.amount.toString(),
              currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            }
          : null
      }
    />
  );
}
