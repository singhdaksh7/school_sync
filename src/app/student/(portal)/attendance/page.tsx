"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ClipboardCheck, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface AttendanceRecord {
  id: string;
  date: string;
  status: "PRESENT" | "ABSENT" | "LATE";
}

interface Summary {
  present: number;
  absent: number;
  late: number;
  total: number;
  percentage: number;
}

const STATUS_STYLES: Record<AttendanceRecord["status"], string> = {
  PRESENT: "bg-green-500",
  ABSENT: "bg-red-500",
  LATE: "bg-yellow-500",
};

const STATUS_BADGE: Record<AttendanceRecord["status"], "success" | "destructive" | "warning"> = {
  PRESENT: "success",
  ABSENT: "destructive",
  LATE: "warning",
};

const STATUS_LABEL_KEY: Record<AttendanceRecord["status"], string> = {
  PRESENT: "studentAttendance.present",
  ABSENT: "studentAttendance.absent",
  LATE: "studentAttendance.late",
};

export default function StudentAttendancePage() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/attendance")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setRecords(d.attendance || []);
          setSummary(d.summary || null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const currentMonthSummary = useMemo(() => {
    const now = new Date();
    const inMonth = records.filter((r) => {
      const d = new Date(r.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    let present = 0, absent = 0, late = 0;
    for (const r of inMonth) {
      if (r.status === "PRESENT") present += 1;
      else if (r.status === "ABSENT") absent += 1;
      else late += 1;
    }
    const total = inMonth.length;
    return { present, absent, late, total, percentage: total > 0 ? Math.round(((present + late) / total) * 100) : 0 };
  }, [records]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("studentAttendance.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studentAttendance.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("studentAttendance.overall")}</p>
                <p className="mt-1 text-3xl font-bold text-foreground">{summary?.percentage ?? 0}%</p>
              </div>
              <ClipboardCheck className="h-8 w-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("studentAttendance.present")}</p>
                <p className="mt-1 text-3xl font-bold text-foreground">{summary?.present ?? 0}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("studentAttendance.absent")}</p>
                <p className="mt-1 text-3xl font-bold text-foreground">{summary?.absent ?? 0}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("studentAttendance.late")}</p>
                <p className="mt-1 text-3xl font-bold text-foreground">{summary?.late ?? 0}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("studentAttendance.thisMonth")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{currentMonthSummary.percentage}%</span>
            <span className="text-sm text-muted-foreground">{t("studentAttendance.daysPresent", { count: currentMonthSummary.present + currentMonthSummary.late, total: currentMonthSummary.total })}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${currentMonthSummary.percentage}%` }} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("studentAttendance.trend")}</CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("studentAttendance.noRecords")}</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {[...records].reverse().map((r) => (
                <div
                  key={r.id}
                  title={`${format(new Date(r.date), "dd MMM")} — ${r.status}`}
                  className={`flex-1 rounded-t-sm ${STATUS_STYLES[r.status]} ${r.status === "ABSENT" ? "h-1/3" : r.status === "LATE" ? "h-2/3" : "h-full"}`}
                />
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> {t("studentAttendance.present")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" /> {t("studentAttendance.late")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> {t("studentAttendance.absent")}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("studentAttendance.dailyLog")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {records.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("studentAttendance.noRecords")}</p>
          ) : (
            <div className="divide-y divide-border">
              {records.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-foreground">{format(new Date(r.date), "EEEE, dd MMM yyyy")}</span>
                  <Badge variant={STATUS_BADGE[r.status]}>{t(STATUS_LABEL_KEY[r.status])}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
