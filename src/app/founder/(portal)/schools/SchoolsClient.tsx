"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatCurrency } from "@/lib/utils";
import { SCHOOL_STATUSES, SCHOOL_STATUS_LABEL, SCHOOL_STATUS_BADGE_VARIANT, type SchoolStatusValue } from "@/lib/school-status";

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  status: SchoolStatusValue;
  createdAt: string;
  _count: { students: number; teachers: number; guardians: number; admins: number };
  subscription: { billingCycle: "MONTHLY" | "ANNUAL"; amount: string; plan: { name: string } } | null;
};

type SchoolsResponse = {
  schools: SchoolRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function SchoolsClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SchoolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [query, status]);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) {
        setLoading(true);
        setError(false);
      }
    }, 0);

    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (status !== "ALL") params.set("status", status);

    fetch(`/api/founder/schools?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Request failed"))))
      .then((json: SchoolsResponse) => {
        if (active) setData(json);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [query, status, page]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Schools</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every school on the SchoolSync platform.</p>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">All Schools{data ? ` (${data.total})` : ""}</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {SCHOOL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCHOOL_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or slug..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonTable />
          ) : error ? (
            <ErrorState />
          ) : !data || data.schools.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">School Name</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Plan</th>
                      <th className="pb-2 pr-4 font-medium">Students</th>
                      <th className="pb-2 pr-4 font-medium">Teachers</th>
                      <th className="pb-2 pr-4 font-medium">Admins</th>
                      <th className="pb-2 pr-4 font-medium">Created</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schools.map((school) => (
                      <tr
                        key={school.id}
                        onClick={() => router.push(`/founder/schools/${school.id}`)}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-3 pr-4 font-medium text-foreground">{school.name}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={SCHOOL_STATUS_BADGE_VARIANT[school.status]}>
                            {SCHOOL_STATUS_LABEL[school.status]}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {school.subscription ? (
                            <span>
                              {school.subscription.plan.name}{" "}
                              <span className="text-xs">({formatCurrency(school.subscription.amount)}/{school.subscription.billingCycle === "ANNUAL" ? "yr" : "mo"})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.students}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.teachers}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.admins}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatDate(school.createdAt)}</td>
                        <td className="py-3 text-right text-muted-foreground">
                          <ChevronRight className="ml-auto h-4 w-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {data.page} of {data.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
      <Building2 className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No schools found</p>
      <p className="text-xs text-muted-foreground">
        {query ? `No results for "${query}".` : "No schools match the selected filters."}
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 py-14 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium text-foreground">Couldn&apos;t load schools</p>
      <p className="text-xs text-muted-foreground">Something went wrong. Please refresh the page.</p>
    </div>
  );
}
