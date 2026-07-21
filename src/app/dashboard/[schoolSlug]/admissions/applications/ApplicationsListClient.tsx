"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import NewApplicationDialog from "./NewApplicationDialog";

type Cycle = { id: string; name: string; sessionLabel: string; status: string };
type Offering = { id: string; admissionCycleId: string; className: string };
type Row = {
  id: string;
  applicationNumber: string;
  status: string;
  applicantName: string;
  requestedClassName: string | null;
  guardianName: string;
  guardianPhone: string;
  submittedAt: string | null;
  createdAt: string;
};

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
const ALL_STATUSES = Object.keys(STATUS_LABELS);

export default function ApplicationsListClient({
  schoolSlug,
  schoolId,
  canCreate,
  cycles,
  offerings,
}: {
  schoolSlug: string;
  schoolId: string;
  canCreate: boolean;
  cycles: Cycle[];
  offerings: Offering[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("applicantName", search);
      if (statusFilter) params.set("status", statusFilter);
      if (cycleFilter) params.set("cycleId", cycleFilter);
      const res = await fetch(`/api/schools/${schoolId}/admissions/applications?${params}`);
      if (!res.ok) throw new Error("Failed to load applications");
      const data = await res.json();
      setRows(data.data);
      setTotal(data.pagination.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [schoolId, page, limit, search, statusFilter, cycleFilter]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, cycleFilter]);

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Applications</h1>
        {canCreate && <Button onClick={() => setShowCreate(true)}>New application</Button>}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Search applicant name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                  load();
                }
              }}
              className="max-w-xs"
            />
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={cycleFilter}
              onChange={(e) => {
                setCycleFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All cycles</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.sessionLabel})
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No applications found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Application #</th>
                    <th className="py-2 pr-4">Applicant</th>
                    <th className="py-2 pr-4">Requested class</th>
                    <th className="py-2 pr-4">Guardian contact</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/dashboard/${schoolSlug}/admissions/applications/${row.id}`} className="text-primary hover:underline">
                          {row.applicationNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{row.applicantName}</td>
                      <td className="py-2 pr-4">{row.requestedClassName ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {row.guardianName} · {row.guardianPhone}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">{row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} className="mt-4" />
        </CardContent>
      </Card>

      {showCreate && (
        <NewApplicationDialog
          schoolId={schoolId}
          cycles={cycles}
          offerings={offerings}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}
