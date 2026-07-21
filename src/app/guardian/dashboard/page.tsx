"use client";

import { useEffect, useState } from "react";
import {
  IndianRupee, ClipboardCheck, BookOpenCheck, Award, ClipboardList,
  CalendarDays, Megaphone, Users, Check, X, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { guardianFetch } from "@/lib/guardian-auth-client";
import { useGuardianContext } from "@/components/guardian/GuardianContext";

/* ---------- API response shapes (verified against each route file) ---------- */

interface FeeAccount {
  student: { id: string; name: string; rollNo: string };
  feeStructure: { id: string; name: string };
  totalFee: number;
  paidTillDate: number;
  remainingAmount: number;
  status: string;
}
interface FeesResponse { pendingFees: FeeAccount[]; feeAccounts: FeeAccount[] }

interface AttendanceRecord { id: string; date: string; status: "PRESENT" | "ABSENT" | "LATE" }
interface AttendanceResponse { attendance: AttendanceRecord[] }

interface HomeworkItem {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  homeworkStatus: string;
  submissionStatus: string | null;
  student: { id: string; name: string };
  teacher: { name: string } | null;
}
interface HomeworkResponse { homework: HomeworkItem[] }

interface MarkItem {
  id: string;
  marks: number;
  maxMarks: number;
  grade: string;
  exam: { name: string; scheme: { name: string } };
}
interface MarksResponse { marks: MarkItem[] }

interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  period: number;
  subject: string | null;
  teacher: { name: string } | null;
}
interface TimetableResponse { timetable: TimetableSlot[] }

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  createdBy: { name: string; role: string } | null;
}
interface AnnouncementsResponse { announcements: AnnouncementItem[] }

interface ReportCardItem {
  id: string;
  student: { name: string };
  examScheme: { name: string };
  percentage: number;
  grade: string;
  publishedAt: string | null;
}
interface ReportCardsResponse { reportCards: ReportCardItem[] }

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ATT_STATUS_ICON: Record<string, { icon: typeof Check; color: string }> = {
  PRESENT: { icon: Check, color: "text-green-700 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-300" },
  ABSENT: { icon: X, color: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-300" },
  LATE: { icon: Clock, color: "text-yellow-700 bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300" },
};

/**
 * Fetches an /api/parent/* module's data for the currently selected child.
 * Returns null data (=> hide the section) on 403/network error — 403 means
 * the school's plan has that module disabled (requireSchoolFeature); a 401
 * is handled globally by guardianFetch (session clear + redirect), not here.
 *
 * `data` is cleared synchronously whenever `path` changes — including a
 * child switch, which changes the `studentId` query param and therefore
 * `path` itself — so the previous child's data never lingers on screen
 * while the new child's request is in flight, and a failed fetch for the
 * new child leaves `error` set (a visible error state) rather than quietly
 * keeping the old child's numbers up with no indication anything went wrong.
 */
function useGuardianModule<T>(path: string | null): { data: T | null; loading: boolean; error: boolean } {
  // `prevPath` lets us detect a path change (e.g. a child switch) during
  // render and reset state right there, instead of in the effect below.
  // Resetting inside the effect would mean the previous child's data is
  // still on screen for one paint after the switch — the effect runs after
  // commit — before being cleared; adjusting state during render bails out
  // and re-renders with the cleared state before anything is painted.
  const [prevPath, setPrevPath] = useState(path);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState(false);

  if (path !== prevPath) {
    setPrevPath(path);
    setData(null);
    setError(false);
    setLoading(path !== null);
  }

  useEffect(() => {
    if (!path) return;
    let active = true;
    guardianFetch(path)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((json) => { if (active) { setData(json); setLoading(false); } })
      .catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; };
  }, [path]);

  return { data, loading, error };
}

function ModuleError({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-destructive">{message}</p>;
}

function SectionCard({ id, icon: Icon, title, desc, children }: { id: string; icon: typeof IndianRupee; title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20 border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}

export default function GuardianDashboardPage() {
  const { t } = useTranslation();
  const { user, children: kids, selectedChildId, loading: kidsLoading } = useGuardianContext();

  const fees = useGuardianModule<FeesResponse>("/api/parent/fees");
  const attendance = useGuardianModule<AttendanceResponse>(selectedChildId ? `/api/parent/attendance?studentId=${selectedChildId}` : null);
  const homework = useGuardianModule<HomeworkResponse>(selectedChildId ? `/api/parent/homework?studentId=${selectedChildId}` : "/api/parent/homework");
  const marks = useGuardianModule<MarksResponse>(selectedChildId ? `/api/parent/marks?studentId=${selectedChildId}` : null);
  const timetable = useGuardianModule<TimetableResponse>(selectedChildId ? `/api/parent/timetable?studentId=${selectedChildId}` : null);
  const announcements = useGuardianModule<AnnouncementsResponse>("/api/parent/announcements");
  const reportCards = useGuardianModule<ReportCardsResponse>(selectedChildId ? `/api/parent/report-cards?studentId=${selectedChildId}` : "/api/parent/report-cards");

  const selectedChild = kids.find((c) => c.id === selectedChildId);
  const presentCount = attendance.data?.attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length ?? 0;
  const totalAtt = attendance.data?.attendance.length ?? 0;
  const attPct = totalAtt > 0 ? Math.round((presentCount / totalAtt) * 100) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, rgba(14,165,233,0.14), rgba(99,102,241,0.05) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{formatDate(new Date())}</p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {t("guardian.welcomeBack", { name: (user?.name || "").split(" ")[0] || "" })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("guardian.dashboardSubtitle")}</p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* Children overview */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> {t("guardian.myChildren")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {kidsLoading ? (
            <EmptyState message={t("common.loading")} />
          ) : kids.length === 0 ? (
            <EmptyState message={t("guardian.noChildrenLinked")} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {kids.map((child) => (
                <div
                  key={child.id}
                  className={
                    "rounded-xl border p-3 " +
                    (child.id === selectedChildId ? "border-primary/60 bg-primary/5" : "border-border")
                  }
                >
                  <p className="text-sm font-semibold text-foreground">{child.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("studentDashboard.classSection", { className: child.section.class.name, sectionName: child.section.name, rollNo: child.rollNo })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Fees */}
        {fees.data && (
          <SectionCard id="fees" icon={IndianRupee} title={t("guardian.fees")} desc={t("guardian.feesDesc")}>
            {fees.data.pendingFees.length === 0 ? (
              <EmptyState message={t("guardian.noPendingFees")} />
            ) : (
              <div className="space-y-3">
                {fees.data.pendingFees.slice(0, 6).map((account, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{account.feeStructure.name}</p>
                      <p className="text-xs text-muted-foreground">{account.student.name}</p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">₹{account.remainingAmount}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {fees.error && (
          <SectionCard id="fees" icon={IndianRupee} title={t("guardian.fees")} desc={t("guardian.feesDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Attendance */}
        {selectedChildId && attendance.data && (
          <SectionCard id="attendance" icon={ClipboardCheck} title={t("nav.attendance")} desc={t("guardian.attendanceDesc")}>
            {attendance.data.attendance.length === 0 ? (
              <EmptyState message={t("guardian.noAttendanceYet")} />
            ) : (
              <>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{attPct}%</span>
                  <span className="text-sm text-muted-foreground">{selectedChild?.name}</span>
                </div>
                <div className="space-y-2">
                  {attendance.data.attendance.slice(0, 6).map((rec) => {
                    const cfg = ATT_STATUS_ICON[rec.status];
                    return (
                      <div key={rec.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{formatDate(rec.date)}</span>
                        {cfg && (
                          <span className={"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold " + cfg.color}>
                            <cfg.icon className="h-3 w-3" /> {t(`common.${rec.status.toLowerCase()}`)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </SectionCard>
        )}
        {!selectedChildId && !kidsLoading && kids.length > 0 && (
          <SectionCard id="attendance" icon={ClipboardCheck} title={t("nav.attendance")} desc={t("guardian.attendanceDesc")}>
            <EmptyState message={t("guardian.selectChildPrompt")} />
          </SectionCard>
        )}
        {selectedChildId && attendance.error && (
          <SectionCard id="attendance" icon={ClipboardCheck} title={t("nav.attendance")} desc={t("guardian.attendanceDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Homework */}
        {homework.data && (
          <SectionCard id="homework" icon={BookOpenCheck} title={t("nav.homework")} desc={t("guardian.homeworkDesc")}>
            {homework.data.homework.length === 0 ? (
              <EmptyState message={t("guardian.noHomework")} />
            ) : (
              <div className="space-y-2">
                {homework.data.homework.slice(0, 6).map((hw) => (
                  <div key={hw.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{hw.title}</p>
                      <p className="text-xs text-muted-foreground">{hw.subject} &middot; {hw.student.name}</p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">{formatDate(hw.dueDate)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {homework.error && (
          <SectionCard id="homework" icon={BookOpenCheck} title={t("nav.homework")} desc={t("guardian.homeworkDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Marks */}
        {selectedChildId && marks.data && (
          <SectionCard id="marks" icon={Award} title={t("nav.marks")} desc={t("guardian.marksDesc")}>
            {marks.data.marks.length === 0 ? (
              <EmptyState message={t("guardian.noMarksYet")} />
            ) : (
              <div className="space-y-2">
                {marks.data.marks.slice(0, 6).map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{m.exam.name}</p>
                      <p className="text-xs text-muted-foreground">{m.exam.scheme.name}</p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">{m.marks}/{m.maxMarks} &middot; {m.grade}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {selectedChildId && marks.error && (
          <SectionCard id="marks" icon={Award} title={t("nav.marks")} desc={t("guardian.marksDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Report cards */}
        {reportCards.data && (
          <SectionCard id="report-cards" icon={ClipboardList} title={t("nav.reportCards")} desc={t("guardian.reportCardsDesc")}>
            {reportCards.data.reportCards.length === 0 ? (
              <EmptyState message={t("guardian.noReportCardsYet")} />
            ) : (
              <div className="space-y-2">
                {reportCards.data.reportCards.slice(0, 6).map((rc) => (
                  <div key={rc.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{rc.examScheme.name}</p>
                      <p className="text-xs text-muted-foreground">{rc.student.name} &middot; {rc.publishedAt ? formatDate(rc.publishedAt) : ""}</p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">{rc.percentage.toFixed(1)}% &middot; {rc.grade}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {reportCards.error && (
          <SectionCard id="report-cards" icon={ClipboardList} title={t("nav.reportCards")} desc={t("guardian.reportCardsDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Timetable */}
        {selectedChildId && timetable.data && (
          <SectionCard id="timetable" icon={CalendarDays} title={t("nav.timetable")} desc={t("guardian.timetableDesc")}>
            {timetable.data.timetable.length === 0 ? (
              <EmptyState message={t("guardian.noTimetableYet")} />
            ) : (
              <div className="space-y-2">
                {timetable.data.timetable.slice(0, 8).map((slot) => (
                  <div key={slot.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{DAY_NAMES[slot.dayOfWeek]} &middot; P{slot.period}</span>
                    <span className="font-medium text-foreground">{slot.subject || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {selectedChildId && timetable.error && (
          <SectionCard id="timetable" icon={CalendarDays} title={t("nav.timetable")} desc={t("guardian.timetableDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}

        {/* Announcements */}
        {announcements.data && (
          <SectionCard id="announcements" icon={Megaphone} title={t("nav.announcements")} desc={t("guardian.announcementsDesc")}>
            {announcements.data.announcements.length === 0 ? (
              <EmptyState message={t("guardian.noAnnouncements")} />
            ) : (
              <div className="space-y-3">
                {announcements.data.announcements.slice(0, 5).map((a) => (
                  <div key={a.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(a.publishedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
        {announcements.error && (
          <SectionCard id="announcements" icon={Megaphone} title={t("nav.announcements")} desc={t("guardian.announcementsDesc")}>
            <ModuleError message={t("guardian.loadFailed")} />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
