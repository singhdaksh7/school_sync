"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  _count: { students: number; teachers: number; guardians: number; admins: number };
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
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SchoolsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) setLoading(true);
    }, 0);
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);

    fetch(`/api/founder/schools?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: SchoolsResponse | null) => {
        if (active && json) setData(json);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [query, page]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Schools</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every school on the SchoolSync platform.</p>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">All Schools{data ? ` (${data.total})` : ""}</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search schools..."
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonTable />
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
                      <th className="pb-2 pr-4 font-medium">Students</th>
                      <th className="pb-2 pr-4 font-medium">Teachers</th>
                      <th className="pb-2 pr-4 font-medium">Parents</th>
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
                          <Badge variant={school.status === "ACTIVE" ? "success" : "secondary"}>
                            {school.status === "ACTIVE" ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.students}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.teachers}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{school._count.guardians}</td>
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
        {query ? `No results for "${query}".` : "No schools have signed up yet."}
      </p>
    </div>
  );
}
