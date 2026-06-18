import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";

export async function PATCH() {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.founderNotification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
