import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allStudentsBelongToSchool, canAccessSchool, examSchemeBelongsToSchool, getExamInSchool, sectionBelongsToSchool } from "@/lib/tenant";

// GET all results for a scheme (with optional sectionId filter)
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; schemeId: string }> }) {
  const { schoolId, schemeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await examSchemeBelongsToSchool(schemeId, schoolId))) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  if (sectionId && !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }

  const results = await prisma.examResult.findMany({
    where: {
      exam: { schemeId, scheme: { schoolId } },
      student: { schoolId, ...(sectionId ? { sectionId } : {}) },
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
  if (!(await canAccessSchool(schoolId, userId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await examSchemeBelongsToSchool(schemeId, schoolId))) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });

  const { examId, results } = await req.json();
  if (!examId || !Array.isArray(results)) {
    return NextResponse.json({ error: "examId and results array required" }, { status: 400 });
  }

  const exam = await getExamInSchool(examId, schoolId, schemeId);
  if (!exam) return NextResponse.json({ error: "Exam not found in this scheme" }, { status: 404 });

  const submitted = results as { studentId: string; marks: number | null }[];
  if (!(await allStudentsBelongToSchool(submitted.map((r) => r.studentId), schoolId))) {
    return NextResponse.json({ error: "One or more students are not in this school" }, { status: 400 });
  }

  const upserts = submitted
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
