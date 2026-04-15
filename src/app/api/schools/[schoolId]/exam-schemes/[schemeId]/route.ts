import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canView(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

async function canWrite(schoolId: string, userId: string, role: string) {
  if (role === "VICE_PRINCIPAL") return false;
  return canView(schoolId, userId);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; schemeId: string }> }) {
  const { schoolId, schemeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role as string;
  if (!(await canWrite(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.examScheme.delete({ where: { id: schemeId } });
  return NextResponse.json({ success: true });
}
