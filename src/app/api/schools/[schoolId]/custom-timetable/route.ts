import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canWrite(schoolId: string, userId: string, role: string) {
  if (role === "VICE_PRINCIPAL") return false;
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

type SubjectConfig = {
  name: string;
  weeklyCount: number;
  teacherId: string;
  teacherName: string;
  consecutiveCount: number;          // periods per block (1 = no grouping)
  distribution: "spread" | "random"; // how to place blocks across days
  maxPerDay: number;                 // max periods of this subject per day (1 or 2)
};

type GeneratedSlot = {
  dayOfWeek: number;
  period: number;
  subject: string;
  teacherId: string;
  teacherName: string;
};

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateTimetable(
  subjects: SubjectConfig[],
  periodsPerDay: number,
  daysPerWeek: number,
  busySlots: { teacherId: string; dayOfWeek: number; period: number }[]
): GeneratedSlot[] {
  const busySet = new Set(busySlots.map((s) => `${s.teacherId}-${s.dayOfWeek}-${s.period}`));

  // grid[dayIdx][periodIdx]
  const grid: (GeneratedSlot | null)[][] = Array.from({ length: daysPerWeek }, () =>
    Array.from({ length: periodsPerDay }, () => null)
  );

  const canPlaceBlock = (
    dayIdx: number,
    startPIdx: number,
    blockSize: number,
    teacherId: string
  ): boolean => {
    for (let p = 0; p < blockSize; p++) {
      const pIdx = startPIdx + p;
      if (pIdx >= periodsPerDay) return false;
      if (grid[dayIdx][pIdx] !== null) return false;
      if (busySet.has(`${teacherId}-${dayIdx + 1}-${pIdx + 1}`)) return false;
    }
    return true;
  };

  const placeBlock = (dayIdx: number, startPIdx: number, blockSize: number, subj: SubjectConfig) => {
    for (let p = 0; p < blockSize; p++) {
      const pIdx = startPIdx + p;
      const day = dayIdx + 1;
      const period = pIdx + 1;
      grid[dayIdx][pIdx] = {
        dayOfWeek: day,
        period,
        subject: subj.name,
        teacherId: subj.teacherId,
        teacherName: subj.teacherName,
      };
      busySet.add(`${subj.teacherId}-${day}-${period}`);
    }
  };

  for (const subj of subjects) {
    const blockSize = Math.max(1, Math.min(subj.consecutiveCount ?? 1, periodsPerDay));
    const fullBlocks = Math.floor(subj.weeklyCount / blockSize);
    const remainder = subj.weeklyCount % blockSize;

    // blocksPlacedPerDay tracks how many blocks of THIS subject are on each day
    const blocksOnDay = new Array(daysPerWeek).fill(0);

    // periodsOnDay tracks total period slots used by this subject per day
    const periodsOnDay = new Array(daysPerWeek).fill(0);
    const dailyCap = Math.max(1, subj.maxPerDay ?? 2);

    const placeNBlocks = (count: number, size: number) => {
      let placed = 0;

      // Build all valid (dayIdx, startPIdx) candidates for this block size
      type Candidate = { dayIdx: number; pIdx: number };
      const candidates: Candidate[] = [];
      for (let d = 0; d < daysPerWeek; d++) {
        for (let p = 0; p <= periodsPerDay - size; p++) {
          candidates.push({ dayIdx: d, pIdx: p });
        }
      }

      if (subj.distribution === "random") {
        shuffle(candidates);
      } else {
        // Spread: sort by fewest blocks of this subject on that day first,
        // break ties randomly so we don't always pick Monday
        shuffle(candidates);
        candidates.sort((a, b) => blocksOnDay[a.dayIdx] - blocksOnDay[b.dayIdx]);
      }

      for (const { dayIdx, pIdx } of candidates) {
        if (placed >= count) break;
        // Enforce per-day cap for this subject
        if (periodsOnDay[dayIdx] + size > dailyCap) continue;
        if (!canPlaceBlock(dayIdx, pIdx, size, subj.teacherId)) continue;
        placeBlock(dayIdx, pIdx, size, subj);
        blocksOnDay[dayIdx]++;
        periodsOnDay[dayIdx] += size;
        placed++;
      }
    };

    if (fullBlocks > 0) placeNBlocks(fullBlocks, blockSize);
    // Place leftover periods as individual slots
    if (remainder > 0) placeNBlocks(remainder, 1);
  }

  return grid.flat().filter(Boolean) as GeneratedSlot[];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role as string;
  if (!(await canWrite(schoolId, session.user.id, role)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { action } = body;

  if (action === "generate") {
    const { sectionId, periodsPerDay, daysPerWeek, subjects } = body as {
      sectionId: string;
      periodsPerDay: number;
      daysPerWeek: number;
      subjects: SubjectConfig[];
    };

    if (!sectionId || !subjects?.length)
      return NextResponse.json({ error: "sectionId and subjects are required" }, { status: 400 });

    const allSlots = await prisma.timetableSlot.findMany({
      where: { schoolId, NOT: { sectionId } },
      select: { teacherId: true, dayOfWeek: true, period: true },
    });
    const busySlots = allSlots.filter((s) => s.teacherId) as {
      teacherId: string; dayOfWeek: number; period: number;
    }[];

    const slots = generateTimetable(subjects, periodsPerDay, daysPerWeek, busySlots);
    return NextResponse.json({ slots });
  }

  if (action === "save") {
    const { sectionId, slots } = body as {
      sectionId: string;
      slots: { dayOfWeek: number; period: number; subject: string; teacherId: string }[];
    };

    if (!sectionId || !slots)
      return NextResponse.json({ error: "sectionId and slots are required" }, { status: 400 });

    await prisma.timetableSlot.deleteMany({ where: { sectionId, schoolId } });
    await prisma.timetableSlot.createMany({
      data: slots.map((s) => ({
        schoolId,
        sectionId,
        dayOfWeek: s.dayOfWeek,
        period: s.period,
        teacherId: s.teacherId || null,
        subject: s.subject || null,
      })),
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
