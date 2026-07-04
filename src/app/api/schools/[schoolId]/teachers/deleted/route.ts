import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { parsePagination, paginated } from "@/lib/pagination";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const { skip, take, page, limit } = parsePagination(searchParams);
  const where = { schoolId, isDeleted: true };
  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      include: { deletedBy: { select: { id: true, name: true } } },
      orderBy: { deletedAt: "desc" },
      skip,
      take,
    }),
    prisma.teacher.count({ where }),
  ]);

  return NextResponse.json(paginated(teachers, total, { skip, take, page, limit }));
}
