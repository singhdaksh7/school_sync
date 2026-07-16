"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Summary = Awaited<ReturnType<typeof import("@/lib/admissions/dashboard").getAdmissionsDashboardSummary>>;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  DOCUMENTS_PENDING: "Documents pending",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  ASSESSMENT_SCHEDULED: "Assessment scheduled",
  WAITLISTED: "Waitlisted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  ENROLLED: "Enrolled",
};

export default function AdmissionsDashboardClient({
  schoolSlug,
  summary,
  canManage,
}: {
  schoolSlug: string;
  summary: Summary;
  canManage: boolean;
}) {
  const base = `/dashboard/${schoolSlug}/admissions`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admissions</h1>
          <p className="text-sm text-muted-foreground">
            {summary.currentCycle
              ? `Current cycle: ${summary.currentCycle.name} (${summary.currentCycle.sessionLabel}) — ${summary.currentCycle.status}`
              : "No open admission cycle"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`${base}/applications`}>View applications</Link>
          </Button>
          {canManage && (
            <Button asChild>
              <Link href={`${base}/cycles`}>Manage cycles</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total applications</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.totalApplications}</CardContent>
        </Card>
        {(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "ENROLLED"] as const).map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{STATUS_LABELS[key]}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.statusBuckets[key] ?? 0}</CardContent>
          </Card>
        ))}
      </div>

      {summary.capacityByClass.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Capacity vs approved/enrolled (current cycle)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Class</th>
                    <th className="py-2 pr-4">Capacity</th>
                    <th className="py-2 pr-4">Approved</th>
                    <th className="py-2 pr-4">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.capacityByClass.map((row) => (
                    <tr key={row.classId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.className}</td>
                      <td className="py-2 pr-4">{row.capacity}</td>
                      <td className="py-2 pr-4">{row.approved}</td>
                      <td className="py-2 pr-4">{row.enrolled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent applications</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No applications yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Application #</th>
                    <th className="py-2 pr-4">Applicant</th>
                    <th className="py-2 pr-4">Class</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`${base}/applications/${row.id}`} className="text-primary hover:underline">
                          {row.applicationNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{row.applicantName}</td>
                      <td className="py-2 pr-4">{row.requestedClassName ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
