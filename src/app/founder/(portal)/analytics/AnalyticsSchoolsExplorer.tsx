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
import { useTranslation } from "@/lib/i18n/LanguageContext";

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  status: SchoolStatusValue;
  createdAt: string;
  _count: { students: number; teachers: number; guardians: number; admins: number };
  subscription: { billingCycle: "MONTHLY" | "ANNUAL"; amount: string; plan: { name: string } } | null;
  isOverdue: boolean;
};

type SchoolsResponse = {
  schools: SchoolRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type Plan = { id: string; name: string };

export default function AnalyticsSchoolsExplorer() {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [planId, setPlanId] = useState<string>("ALL");
  const [billing, setBilling] = useState<string>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SchoolsResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/founder/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { plans: Plan[] }) => setPlans(json.plans))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [query, status, planId, billing, from, to]);

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
    if (planId !== "ALL") params.set("planId", planId);
    if (billing !== "ALL") params.set("billing", billing);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

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
  }, [query, status, planId, billing, from, to, page]);

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{t("founder.schoolsExplorer")}{data ? ` (${data.total})` : ""}</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("founder.searchByNameOrSlug")}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder={t("founder.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("founder.allStatuses")}</SelectItem>
              {SCHOOL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCHOOL_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder={t("founder.plan")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("founder.allPlans")}</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={billing} onValueChange={setBilling}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder={t("founder.billing")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("founder.allBilling")}</SelectItem>
              <SelectItem value="overdue">{t("founder.overdue")}</SelectItem>
              <SelectItem value="current">{t("founder.current")}</SelectItem>
            </SelectContent>
          </Select>

          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" aria-label={t("founder.registeredFrom")} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" aria-label={t("founder.registeredTo")} />
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
                    <th className="pb-2 pr-4 font-medium">{t("founder.schoolName")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.status")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.plan")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.students")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.teachers")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.created")}</th>
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
                        <div className="flex items-center gap-1.5">
                          <Badge variant={SCHOOL_STATUS_BADGE_VARIANT[school.status]}>
                            {SCHOOL_STATUS_LABEL[school.status]}
                          </Badge>
                          {school.isOverdue && <Badge variant="destructive">{t("founder.overdue")}</Badge>}
                        </div>
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
                {t("founder.pageOf", { page: data.page, totalPages: data.totalPages })}
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
      <Building2 className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{t("founder.noSchoolsFound")}</p>
      <p className="text-xs text-muted-foreground">
        {query ? t("founder.noResultsForQuery", { query }) : t("founder.noSchoolsMatchFilters")}
      </p>
    </div>
  );
}

function ErrorState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 py-14 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium text-foreground">{t("founder.couldntLoadSchools")}</p>
      <p className="text-xs text-muted-foreground">{t("founder.somethingWentWrongRefresh")}</p>
    </div>
  );
}
