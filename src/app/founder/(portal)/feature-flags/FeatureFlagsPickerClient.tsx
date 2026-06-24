"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, ChevronRight, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SCHOOL_STATUS_LABEL, SCHOOL_STATUS_BADGE_VARIANT, type SchoolStatusValue } from "@/lib/school-status";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type SchoolRow = { id: string; name: string; slug: string; status: SchoolStatusValue };

export default function FeatureFlagsPickerClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<SchoolRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      if (active) setLoading(true);
    }, 0);

    const params = new URLSearchParams({ page: "1" });
    if (query) params.set("q", query);

    fetch(`/api/founder/schools?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { schools: SchoolRow[] } | null) => {
        if (active && json) setSchools(json.schools);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [query]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("nav.featureFlags")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("founder.selectSchoolToManageFlags")}</p>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{t("founder.chooseASchool")}</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("founder.searchSchools")} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : !schools || schools.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("founder.noSchoolsFound")}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {schools.map((school) => (
                <button
                  key={school.id}
                  onClick={() => router.push(`/founder/schools/${school.id}/feature-flags`)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      <Flag className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{school.name}</p>
                      <p className="text-xs text-muted-foreground">/{school.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={SCHOOL_STATUS_BADGE_VARIANT[school.status]}>{SCHOOL_STATUS_LABEL[school.status]}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
