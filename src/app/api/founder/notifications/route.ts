import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { ensureExpiringSubscriptionNotifications } from "@/lib/founder-notifications";

const PAGE_SIZE = 20;

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensureExpiringSubscriptionNotifications();

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const where = unreadOnly ? { isRead: false } : {};

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.founderNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { school: { select: { id: true, name: true } } },
    }),
    prisma.founderNotification.count({ where }),
    prisma.founderNotification.count({ where: { isRead: false } }),
  ]);

  return NextResponse.json({
    notifications,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    unreadCount,
  });
}
