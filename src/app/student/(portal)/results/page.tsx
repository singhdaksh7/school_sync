"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Award, Download, FileText, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import SubjectMarksTable from "@/components/shared/SubjectMarksTable";

interface ExamMark {
  id: string;
  marks: number;
  grade: string;
  exam: { id: string; name: string; maxMarks: number; scheme: { id: string; name: string } };
}

interface ReportCardSubject {
  subject: string;
  marks: number;
  maxMarks: number;
  grade: string;
  subjectTeacherRemark: string | null;
}

interface ReportCard {
  id: string;
  totalMarks: number;
  percentage: number;
  grade: string;
  classTeacherRemark: string | null;
  publishedAt: string | null;
  examScheme: { name: string };
  generatedByTeacher: { name: string };
  subjects: ReportCardSubject[];
  actionUrl: string | null;
}

export default function StudentResultsPage() {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<ExamMark[]>([]);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/student/marks").then((r) => r.json()),
      fetch("/api/student/report-cards").then((r) => r.json()),
    ])
      .then(([marksData, cardsData]) => {
        if (!marksData.error) setMarks(marksData.marks || []);
        if (!cardsData.error) setReportCards(cardsData.reportCards || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const maxMarksInSet = Math.max(1, ...marks.map((m) => m.exam.maxMarks));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("studentResults.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studentResults.subtitle")}</p>
      </div>

      {/* Performance trend */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            {t("studentResults.performanceTrend")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {marks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("studentResults.noResultsYet")}</p>
          ) : (
            <div className="flex h-40 items-end gap-3 overflow-x-auto pb-1">
              {[...marks].reverse().map((m) => (
                <div key={m.id} className="flex min-w-[44px] flex-1 flex-col items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{m.marks}</span>
                  <div
                    className="w-full rounded-t-md bg-primary transition-all"
                    style={{ height: `${Math.max(8, (m.marks / maxMarksInSet) * 100)}%` }}
                    title={`${m.exam.name}: ${m.marks}/${m.exam.maxMarks}`}
                  />
                  <span className="line-clamp-1 text-center text-[10px] text-muted-foreground">{m.exam.name}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exam results table */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4 text-primary" />
            {t("studentResults.examResults")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {marks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("studentResults.noResultsYet")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">{t("studentResults.exam")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("studentResults.scheme")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("studentResults.marks")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("studentResults.grade")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {marks.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 font-medium text-foreground">{m.exam.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{m.exam.scheme.name}</td>
                      <td className="px-5 py-3 text-foreground">{m.marks} / {m.exam.maxMarks}</td>
                      <td className="px-5 py-3"><Badge variant="default">{m.grade}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Report cards */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" /> {t("studentResults.reportCards")}
        </h2>
        {reportCards.length === 0 ? (
          <Card className="border-border">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">{t("studentResults.noReportCardsYet")}</CardContent>
          </Card>
        ) : (
          reportCards.map((card) => (
            <Card key={card.id} className="border-border">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">{card.examScheme.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {card.publishedAt ? t("studentResults.publishedOn", { date: format(new Date(card.publishedAt), "dd MMM yyyy") }) : t("studentResults.published")} &middot; {t("studentResults.byTeacher", { name: card.generatedByTeacher.name })}
                  </p>
                </div>
                {card.actionUrl && (
                  <a
                    href={card.actionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted/50"
                  >
                    <Download className="h-4 w-4" /> {t("studentResults.downloadPdf")}
                  </a>
                )}
              </CardHeader>
              <CardContent>
                <SubjectMarksTable
                  subjects={card.subjects}
                  totalMarks={card.totalMarks}
                  percentage={card.percentage}
                  grade={card.grade}
                  showRemarks
                  labels={{
                    subject: t("studentResults.subject"),
                    marks: t("studentResults.marks"),
                    grade: t("studentResults.grade"),
                    teacherRemark: t("studentResults.teacherRemark"),
                    totalMarks: t("studentResults.totalMarks"),
                    percentage: t("studentResults.percentage"),
                  }}
                />
                {card.classTeacherRemark && (
                  <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{t("studentResults.classTeacherRemark")}</span>
                    {card.classTeacherRemark}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
