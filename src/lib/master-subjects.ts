/**
 * Master Subject applicability resolution for consumers (like Smart Timetable
 * Weekly Period Requirements) that need "which Subject rows may this
 * class/section use", as opposed to the Subject Master admin screen's exact
 * per-scope view (see the `raw=1` branch of the subjects API route).
 */

import { prisma } from "@/lib/prisma";
import type { Subject } from "@/generated/prisma/client";

function dedupeByName(subjects: Subject[]): Subject[] {
  const byName = new Map<string, Subject>();
  for (const subject of subjects) {
    const key = subject.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, subject);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Subjects a given class/section may use: class-wide (sectionId null) plus
 * any assigned specifically to this section, deduplicated by name (a
 * section-specific row wins over a class-wide row of the same name since it's
 * the more specific configuration). Tenant/class/section scoped throughout —
 * never returns another school's or another class's subjects.
 */
export async function getApplicableSubjects(schoolId: string, classId: string, sectionId: string): Promise<Subject[]> {
  const [sectionSpecific, classWide] = await Promise.all([
    prisma.subject.findMany({ where: { schoolId, classId, sectionId } }),
    prisma.subject.findMany({ where: { schoolId, classId, sectionId: null } }),
  ]);
  return dedupeByName([...sectionSpecific, ...classWide]);
}

/**
 * Resolves a single subjectId only if it is actually applicable to the given
 * school/class/section (class-wide or section-specific) — the server-side
 * gate that a client-selected dropdown value alone cannot enforce.
 */
export async function findApplicableSubject(
  subjectId: string,
  schoolId: string,
  classId: string,
  sectionId: string
): Promise<Subject | null> {
  return prisma.subject.findFirst({
    where: {
      id: subjectId,
      schoolId,
      classId,
      OR: [{ sectionId: null }, { sectionId }],
    },
  });
}
