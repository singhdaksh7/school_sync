import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";

export async function createNotification(input: {
  type: NotificationType;
  title: string;
  message: string;
  schoolId?: string | null;
}) {
  return prisma.founderNotification.create({
    data: {
      type: input.type,
      title: input.title,
      message: input.message,
      schoolId: input.schoolId ?? null,
    },
  });
}

const EXPIRY_WINDOW_DAYS = 7;

// Request-time check (no cron): if a school's subscription renews within the
// next 7 days and we haven't already raised a SUBSCRIPTION_EXPIRING
// notification for it in the last 7 days, raise one now.
export async function ensureExpiringSubscriptionNotifications() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(now.getTime() - EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const expiring = await prisma.school.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIAL"] },
      subscription: { currentPeriodEnd: { gte: now, lte: windowEnd } },
    },
    select: { id: true, name: true, subscription: { select: { currentPeriodEnd: true } } },
  });

  for (const school of expiring) {
    const existing = await prisma.founderNotification.findFirst({
      where: {
        type: "SUBSCRIPTION_EXPIRING",
        schoolId: school.id,
        createdAt: { gte: recentCutoff },
      },
      select: { id: true },
    });
    if (existing) continue;

    await createNotification({
      type: "SUBSCRIPTION_EXPIRING",
      title: "Subscription expiring soon",
      message: `${school.name}'s subscription renews on ${school.subscription?.currentPeriodEnd?.toDateString() ?? "soon"}.`,
      schoolId: school.id,
    });
  }
}
