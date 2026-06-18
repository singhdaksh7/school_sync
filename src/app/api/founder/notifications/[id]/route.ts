import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const isRead = typeof body?.isRead === "boolean" ? body.isRead : true;

  const notification = await prisma.founderNotification.update({
    where: { id },
    data: { isRead },
  }).catch(() => null);

  if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ notification });
}
