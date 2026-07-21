"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Award, BarChart3, BookOpenCheck, Search, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Assignment {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
}

interface StudentStat {
  studentId: string;
  name: string;
  rollNo: string;
  totalAssigned: number;
  completedCount: number;
  missedCount: number;
  completionPercentage: number | null;
}

interface HistoryRow {
  id: string;
  homeworkId: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  subject: string;
  title: string;
  deadlineAt: string;
  completed: boolean;
}

interface DashboardData {
  students: StudentStat[];
  history: HistoryRow[];
  summary: {
    totalHomeworkAssigned: number;
    averagePercentage: number | null;
    above90Count: number;
    below70Count: number;
    mostConsistent: { studentId: string; name: string; percentage: number | null }[];
    needsAttention: { studentId: string; name: string; percentage: number | null }[];
  };
}

type HistoryFilter = "ALL" | "LAST_7_DAYS" | "LAST_30_DAYS" | "THIS_MONTH";

const HISTORY_FILTERS: { key: HistoryFilter; labelKey: string }[] = [
  { key: "ALL", labelKey: "teacherHomeworkDashboard.filterCurrentSession" },
  { key: "LAST_7_DAYS", labelKey: "teacherHomeworkDashboard.filterLast7Days" },
  { key: "LAST_30_DAYS", labelKey: "teacherHomeworkDashboard.filterLast30Days" },
  { key: "THIS_MONTH", labelKey: "teacherHomeworkDashboard.filterThisMonth" },
];

const PAGE_SIZE = 10;

export default function HomeworkClassDashboardPage() {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = window.setTimeout(() => {
      fetch("/api/teacher/homework")
        .then((r) => r.json())
        .then((d) => setAssignments(d.assignments || []));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const selected = useMemo(
    () => assignments.find((a) => `${a.sectionId}|${a.subject}` === selectedKey) || null,
    [assignments, selectedKey]
  );

  const loadDashboard = useCallback(async (sectionId: string, subject: string) => {
    setLoading(true);
    const res = await fetch(`/api/teacher/homework/class-dashboard?sectionId=${sectionId}&subject=${encodeURIComponent(subject)}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return;
    setData(json);
    setPage(1);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (selected) void loadDashboard(selected.sectionId, selected.subject);
      else setData(null);
    }, 0);
    return () => window.clearTimeout(id);
  }, [selected, loadDashboard]);

  const filteredHistory = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    return data.history.filter((row) => {
      const due = new Date(row.deadlineAt);
      if (historyFilter === "LAST_7_DAYS") {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 7);
        if (due < cutoff) return false;
      }
      if (historyFilter === "LAST_30_DAYS") {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 30);
        if (due < cutoff) return false;
      }
      if (historyFilter === "THIS_MONTH" && (due.getMonth() !== now.getMonth() || due.getFullYear() !== now.getFullYear())) {
        return false;
      }
      if (search && !row.studentName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, historyFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const pagedHistory = filteredHistory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/teacher/homework" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("teacherHomeworkDashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("teacherHomeworkDashboard.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-full md:w-96">
              <SelectValue placeholder={t("teacherHomeworkDashboard.selectSectionSubject")} />
            </SelectTrigger>
            <SelectContent>
              {assignments.map((a) => (
                <SelectItem key={`${a.sectionId}|${a.subject}`} value={`${a.sectionId}|${a.subject}`}>
                  {t("teacherHomeworkDashboard.classSectionSubject", { className: a.className, sectionName: a.sectionName, subject: a.subject })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !data ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">{t("teacherHomeworkDashboard.selectToView")}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={BookOpenCheck} label={t("teacherHomeworkDashboard.homeworkAssigned")} value={data.summary.totalHomeworkAssigned} />
            <SummaryCard icon={BarChart3} label={t("teacherHomeworkDashboard.averageCompletion")} value={data.summary.averagePercentage === null ? "-" : `${data.summary.averagePercentage}%`} />
            <SummaryCard icon={TrendingUp} label={t("teacherHomeworkDashboard.studentsAbove90")} value={data.summary.above90Count} tone="green" />
            <SummaryCard icon={TrendingDown} label={t("teacherHomeworkDashboard.studentsBelow70")} value={data.summary.below70Count} tone="red" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4 text-green-600" /> {t("teacherHomeworkDashboard.mostConsistent")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.summary.mostConsistent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("teacherHomeworkDashboard.noDataYet")}</p>
                ) : data.summary.mostConsistent.map((s) => (
                  <div key={s.studentId} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <Badge variant="success">{s.percentage}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-red-600" /> {t("teacherHomeworkDashboard.needsAttention")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.summary.needsAttention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("teacherHomeworkDashboard.noDataYet")}</p>
                ) : data.summary.needsAttention.map((s) => (
                  <div key={s.studentId} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <Badge variant="destructive">{s.percentage}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t("teacherHomeworkDashboard.studentCompletion")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.students.map((s) => (
                <div key={s.studentId} className="flex items-center gap-4">
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{t("teacherHomeworkDashboard.rollLabel", { roll: s.rollNo })}</p>
                  </div>
                  <Progress value={s.completionPercentage ?? 0} toned className="flex-1" />
                  <span className="w-32 shrink-0 text-right text-sm text-muted-foreground">
                    {s.completedCount}/{s.totalAssigned} - {s.completionPercentage === null ? "-" : `${s.completionPercentage}%`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base">{t("teacherHomeworkDashboard.homeworkHistory")}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder={t("teacherHomeworkDashboard.searchStudentPlaceholder")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9 w-48" />
                </div>
                {HISTORY_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => { setHistoryFilter(f.key); setPage(1); }}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      historyFilter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {pagedHistory.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("teacherHomeworkDashboard.noHistoryFound")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">{t("teacherHomeworkDashboard.deadline")}</th>
                        <th className="py-2 pr-3 font-medium">{t("teacherHomeworkDashboard.student")}</th>
                        <th className="py-2 pr-3 font-medium">{t("teacherHomeworkDashboard.subject")}</th>
                        <th className="py-2 pr-3 font-medium">{t("teacherHomeworkDashboard.homework")}</th>
                        <th className="py-2 pr-3 font-medium">{t("teacherHomeworkDashboard.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedHistory.map((row) => (
                        <tr key={row.id} className="border-b border-border last:border-0">
                          <td className="py-2 pr-3 text-muted-foreground">{new Date(row.deadlineAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-3 font-medium text-foreground">{row.studentName}</td>
                          <td className="py-2 pr-3">{row.subject}</td>
                          <td className="py-2 pr-3">{row.title}</td>
                          <td className="py-2 pr-3">
                            <Badge variant={row.completed ? "success" : "destructive"}>{row.completed ? t("teacherHomeworkDashboard.completed") : t("teacherHomeworkDashboard.notCompleted")}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone?: "green" | "red";
}) {
  return (
    <Card>
      <CardContent className="pt-6 flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            tone === "green" ? "bg-green-100 text-green-600" : tone === "red" ? "bg-red-100 text-red-600" : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
