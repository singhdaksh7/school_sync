import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { buildStudentPasswordHashes } from "@/lib/student-credentials";
import { backfillHomeworkStatusForStudent } from "@/lib/homework";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { students } = await req.json();
  if (!Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: "No students provided" }, { status: 400 });
  }

  // Build a map of class name -> section name -> section id for this school
  const classes = await prisma.class.findMany({
    where: { schoolId },
    include: { sections: { select: { id: true, name: true } } },
  });
  const sectionMap: Record<string, string> = {};
  for (const cls of classes) {
    for (const sec of cls.sections) {
      const key = `${cls.name.toLowerCase()}|${sec.name.toLowerCase()}`;
      sectionMap[key] = sec.id;
    }
  }

  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const row of students) {
    const name = String(row.name || "").trim();
    const admissionNo = String(row.admissionno || row.admission_no || "").trim();
    const rollNo = String(row.rollno || row.roll_no || row.roll || "").trim();
    const className = String(row.class || row.classname || "").trim().toLowerCase();
    const sectionName = String(row.section || "").trim().toLowerCase();
    const fatherPhone = String(row.fatherphone || row.father_phone || "").trim();
    const motherPhone = String(row.motherphone || row.mother_phone || "").trim();

    if (!name || name.length < 2) {
      results.push({ name: name || "(empty)", success: false, error: "Name too short" });
      continue;
    }
    if (!admissionNo) {
      results.push({ name, success: false, error: "Admission number missing" });
      continue;
    }
    if (!rollNo) {
      results.push({ name, success: false, error: "Roll number missing" });
      continue;
    }
    if (!fatherPhone && !motherPhone) {
      results.push({ name, success: false, error: "Father Phone or Mother Phone is required so the student can log in" });
      continue;
    }

    const sectionId = sectionMap[`${className}|${sectionName}`];
    if (!sectionId) {
      results.push({ name, success: false, error: `Section not found: Class "${row.class}" Section "${row.section}"` });
      continue;
    }

    try {
      const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(fatherPhone, motherPhone);
      const student = await prisma.student.create({
        data: {
          name,
          admissionNo,
          rollNo,
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          fatherName: row.fathername?.trim() || row.father_name?.trim() || null,
          fatherPhone: fatherPhone || null,
          fatherPhoneHash,
          motherName: row.mothername?.trim() || row.mother_name?.trim() || null,
          motherPhone: motherPhone || null,
          motherPhoneHash,
          sectionId,
          schoolId,
        },
      });
      await backfillHomeworkStatusForStudent(student.id, schoolId, sectionId);
      results.push({ name, success: true });
    } catch {
      results.push({ name, success: false, error: "Duplicate roll number/admission number or invalid data" });
    }
  }

  return NextResponse.json({ results });
}
