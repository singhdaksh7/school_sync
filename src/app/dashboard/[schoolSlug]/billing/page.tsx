import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
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

  const subscription = await prisma.schoolSubscription.findUnique({
    where: { schoolId: school.id },
    include: { plan: true },
  });

  return (
    <BillingClient
      schoolId={school.id}
      status={school.status}
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
