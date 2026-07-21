import { prisma } from "@/lib/prisma";
import { ADMISSION_APPLICATION_STATUSES } from "@/lib/admissions/constants";

/**
 * Dashboard summary counts: current cycle, status-bucket totals, capacity vs
 * approved/enrolled by class (for the current cycle's offerings), and recent
 * applications (table-scoped fields only — see serializeApplicationListItem).
 */
export async function getAdmissionsDashboardSummary(schoolId: string) {
  const currentCycle = await prisma.admissionCycle.findFirst({
    where: { schoolId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });

  const [statusCounts, recent] = await Promise.all([
    prisma.admissionApplication.groupBy({
      by: ["status"],
      where: { schoolId },
      _count: { _all: true },
    }),
    prisma.admissionApplication.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { admissionOffering: { include: { class: true } } },
    }),
  ]);

  const statusBuckets = Object.fromEntries(ADMISSION_APPLICATION_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const row of statusCounts) statusBuckets[row.status] = row._count._all;

  let capacityByClass: { classId: string; className: string; capacity: number; approved: number; enrolled: number }[] = [];
  if (currentCycle) {
    const offerings = await prisma.admissionOffering.findMany({
      where: { admissionCycleId: currentCycle.id },
      include: { class: true },
    });
    const perOffering = await prisma.admissionApplication.groupBy({
      by: ["admissionOfferingId", "status"],
      where: { schoolId, admissionCycleId: currentCycle.id, status: { in: ["APPROVED", "ENROLLED"] } },
      _count: { _all: true },
    });
    capacityByClass = offerings.map((o) => {
      const approved = perOffering.find((p) => p.admissionOfferingId === o.id && p.status === "APPROVED")?._count._all ?? 0;
      const enrolled = perOffering.find((p) => p.admissionOfferingId === o.id && p.status === "ENROLLED")?._count._all ?? 0;
      return { classId: o.classId, className: o.class.name, capacity: o.capacity, approved, enrolled };
    });
  }

  const totalApplications = Object.values(statusBuckets).reduce((a, b) => a + b, 0);

  return {
    currentCycle: currentCycle
      ? { id: currentCycle.id, name: currentCycle.name, sessionLabel: currentCycle.sessionLabel, status: currentCycle.status }
      : null,
    totalApplications,
    statusBuckets,
    capacityByClass,
    recent: recent.map((a) => ({
      id: a.id,
      applicationNumber: a.applicationNumber,
      status: a.status,
      applicantName: [a.applicantFirstName, a.applicantMiddleName, a.applicantLastName].filter(Boolean).join(" "),
      requestedClassName: a.admissionOffering?.class?.name ?? null,
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
