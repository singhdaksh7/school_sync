import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePagination, paginated } from "@/lib/pagination";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const action = searchParams.get("action");
  // Audit logs grow unbounded over a school's lifetime, so this endpoint is
  // paginated. Default 100/page, hard cap 200/page.
  const pageParams = parsePagination(searchParams, { defaultLimit: 100, maxLimit: 200 });

  const where = {
    schoolId,
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
  };

  // Stable ordering (createdAt desc, id desc) so pages never overlap/skip rows
  // that share a timestamp.
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: pageParams.skip,
      take: pageParams.take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json(paginated(logs, total, pageParams));
}
