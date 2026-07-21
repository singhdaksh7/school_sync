import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { parsePagination, paginated } from "@/lib/pagination";
import { serializeLoan } from "@/lib/library/serializers";
import { getSchoolTimezone } from "@/lib/library/http";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  const url = new URL(req.url);
  const pagination = parsePagination(url.searchParams);
  const status = url.searchParams.get("status")?.trim();

  const where: Prisma.LibraryLoanWhereInput = { schoolId: auth.schoolId, studentId: auth.studentId };
  if (status === "ACTIVE" || status === "RETURNED" || status === "LOST" || status === "WRITTEN_OFF") where.status = status;

  const timezone = await getSchoolTimezone(auth.schoolId);
  const [rows, total] = await Promise.all([
    prisma.libraryLoan.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { bookCopy: { include: { book: true } } },
    }),
    prisma.libraryLoan.count({ where }),
  ]);

  return NextResponse.json(paginated(rows.map((l) => serializeLoan(l, { timezone })), total, pagination));
}
