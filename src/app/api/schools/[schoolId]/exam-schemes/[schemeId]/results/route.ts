import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

// GET all results for a scheme (with optional sectionId filter)
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; schemeId: string }> }) {
  const { schoolId, schemeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");

  const results = await prisma.examResult.findMany({
    where: {
      exam: { schemeId },
      ...(sectionId ? { student: { sectionId } } : {}),
    },
    include: {
      exam: { select: { id: true, name: true, maxMarks: true, order: true } },
      student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
    },
    orderBy: [{ exam: { order: "asc" } }, { student: { rollNo: "asc" } }],
  });
  return NextResponse.json(results);
}

// POST: admin bulk upsert results for a section + exam
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; schemeId: string }> }) {
  const { schoolId, schemeId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, userId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { examId, results } = await req.json();
  if (!examId || !Array.isArray(results)) {
    return NextResponse.json({ error: "examId and results array required" }, { status: 400 });
  }

  const exam = await prisma.exam.findFirst({ where: { id: examId, schemeId } });
  if (!exam) return NextResponse.json({ error: "Exam not found in this scheme" }, { status: 404 });

  const upserts = (results as { studentId: string; marks: number | null }[])
    .filter((r) => r.marks !== null && r.marks !== undefined && !isNaN(r.marks))
    .map((r) =>
      prisma.examResult.upsert({
        where: { examId_studentId: { examId, studentId: r.studentId } },
        create: {
          examId,
          studentId: r.studentId,
          marks: Math.min(Math.max(r.marks as number, 0), exam.maxMarks),
          submittedById: userId,
        },
        update: {
          marks: Math.min(Math.max(r.marks as number, 0), exam.maxMarks),
          submittedById: userId,
        },
      })
    );

  await prisma.$transaction(upserts);
  return NextResponse.json({ success: true, count: upserts.length });
}
