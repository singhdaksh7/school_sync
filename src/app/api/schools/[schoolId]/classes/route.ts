import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sortStudentsByRollNumber } from "@/lib/student-ordering";

async function getSchoolAndVerify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return null;
  const hasAccess = school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
  if (!hasAccess) return null;
  return school;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await getSchoolAndVerify(schoolId, session.user.id);
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const classes = await prisma.class.findMany({
    where: { schoolId },
    include: {
      sections: {
        include: {
          _count: { select: { students: true } },
          students: { select: { id: true, name: true, rollNo: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Universal roll-number ordering (canonical comparator — see /lib/student-ordering).
  // Section rosters are small/bounded, so an in-memory sort right after the
  // fetch is both correct and cheap; Prisma's plain-string orderBy above was
  // dropped since it would sort "10" before "2".
  for (const cls of classes) {
    for (const section of cls.sections) {
      section.students = sortStudentsByRollNumber(section.students);
    }
  }

  return NextResponse.json(classes);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await getSchoolAndVerify(schoolId, session.user.id);
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Class name required" }, { status: 400 });

  try {
    const cls = await prisma.class.create({ data: { name: name.trim(), schoolId } });
    return NextResponse.json(cls, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Class name already exists" }, { status: 400 });
  }
}
