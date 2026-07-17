import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";

/**
 * Tenant-scoped aggregate reports (spec §14): requests by status/type,
 * average processing time, certificates issued by type, revoked
 * certificates, pending workload. Aggregates only — no per-student PII.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REPORT_VIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const [byStatus, byType, issuedByType, revokedCount, decided] = await Promise.all([
    prisma.certificateRequest.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } }),
    prisma.certificateRequest.groupBy({ by: ["certificateType"], where: { schoolId }, _count: { _all: true } }),
    prisma.issuedCertificate.groupBy({ by: ["certificateType"], where: { schoolId }, _count: { _all: true } }),
    prisma.issuedCertificate.count({ where: { schoolId, revokedAt: { not: null } } }),
    prisma.certificateRequest.findMany({
      where: { schoolId, reviewedAt: { not: null } },
      select: { createdAt: true, reviewedAt: true },
      take: 500,
      orderBy: { reviewedAt: "desc" },
    }),
  ]);

  const processingMs = decided
    .map((r) => (r.reviewedAt ? r.reviewedAt.getTime() - r.createdAt.getTime() : null))
    .filter((v): v is number => v !== null && v >= 0);
  const avgProcessingHours = processingMs.length > 0 ? processingMs.reduce((a, b) => a + b, 0) / processingMs.length / (1000 * 60 * 60) : null;

  const pendingWorkload = byStatus.filter((s) => s.status === "PENDING" || s.status === "UNDER_REVIEW").reduce((sum, s) => sum + s._count._all, 0);

  return NextResponse.json({
    data: {
      requestsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      requestsByType: byType.map((t) => ({ certificateType: t.certificateType, count: t._count._all })),
      issuedByType: issuedByType.map((t) => ({ certificateType: t.certificateType, count: t._count._all })),
      revokedCount,
      avgProcessingHours,
      pendingWorkload,
    },
  });
}
