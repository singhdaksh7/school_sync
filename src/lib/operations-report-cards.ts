/**
 * School Operations Command Center — report card progress insights (PART 17).
 * Same "no inferred current exam" constraint as operations-exams.ts: requires
 * an explicit `examSchemeId`. Expected count per section is derivable here
 * (student-count-per-section via groupBy) — `expected: null` is kept in the
 * type for sections where it is genuinely unknown (defensive; in practice
 * only zero-student sections are excluded entirely).
 */

import { prisma } from "@/lib/prisma";

export interface ReportCardProgressRow {
  sectionId: string;
  sectionName: string;
  className: string;
  expected: number | null;
  generated: number;
  published: number;
  pendingCount: number | null;
}

export interface ReportCardSchemeProgress {
  examSchemeId: string;
  sections: ReportCardProgressRow[];
  totalGenerated: number;
  totalPublished: number;
}

export async function computeReportCardProgress(schoolId: string, examSchemeId: string): Promise<ReportCardSchemeProgress | null> {
  const scheme = await prisma.examScheme.findFirst({ where: { id: examSchemeId, schoolId }, select: { id: true } });
  if (!scheme) return null;

  const [sections, studentCounts, reportCardCounts] = await Promise.all([
    prisma.section.findMany({ where: { class: { schoolId } }, select: { id: true, name: true, class: { select: { name: true } } } }),
    prisma.student.groupBy({ by: ["sectionId"], where: { schoolId }, _count: { _all: true } }),
    prisma.reportCard.groupBy({ by: ["sectionId", "status"], where: { schoolId, examSchemeId }, _count: { _all: true } }),
  ]);

  const expectedBySection = new Map(studentCounts.map((s) => [s.sectionId, s._count._all]));
  const generatedBySection = new Map<string, number>();
  const publishedBySection = new Map<string, number>();
  for (const row of reportCardCounts) {
    generatedBySection.set(row.sectionId, (generatedBySection.get(row.sectionId) ?? 0) + row._count._all);
    if (row.status === "PUBLISHED") {
      publishedBySection.set(row.sectionId, (publishedBySection.get(row.sectionId) ?? 0) + row._count._all);
    }
  }

  const rows: ReportCardProgressRow[] = sections
    .filter((s) => (expectedBySection.get(s.id) ?? 0) > 0)
    .map((s) => {
      const expected = expectedBySection.get(s.id) ?? null;
      const generated = generatedBySection.get(s.id) ?? 0;
      return {
        sectionId: s.id,
        sectionName: s.name,
        className: s.class.name,
        expected,
        generated,
        published: publishedBySection.get(s.id) ?? 0,
        pendingCount: expected !== null ? Math.max(0, expected - generated) : null,
      };
    });

  return {
    examSchemeId,
    sections: rows,
    totalGenerated: rows.reduce((sum, r) => sum + r.generated, 0),
    totalPublished: rows.reduce((sum, r) => sum + r.published, 0),
  };
}
