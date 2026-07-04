"use client";

import { useEffect, useState } from "react";
import { Award, Download, ListTree, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTeacherPermissions } from "@/hooks/useTeacherPermissions";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import SubjectMarksTable, { type SubjectMark } from "@/components/shared/SubjectMarksTable";

type Scheme = { id: string; name: string };
type MentorSection = {
  id: string;
  name: string;
  class: { name: string };
  students: { id: string; name: string; rollNo: string }[];
};
type ReportCard = {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  totalMarks: number;
  percentage: number;
  grade: string;
  classTeacherRemark: string | null;
  publishedAt: string | null;
  student: { id: string; name: string; rollNo: string };
  examScheme: { id: string; name: string };
  subjects: SubjectMark[];
};

export default function TeacherReportCardsPage() {
  const { t } = useTranslation();
  const [mentorSection, setMentorSection] = useState<MentorSection | null>(null);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [examSchemeId, setExamSchemeId] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [subjectsCard, setSubjectsCard] = useState<ReportCard | null>(null);
  const { has: hasPermission } = useTeacherPermissions();
  const canGenerate = hasPermission("REPORT_CARDS", "GENERATE");
  const canPublish = hasPermission("REPORT_CARDS", "PUBLISH");
  const canDownload = hasPermission("REPORT_CARDS", "DOWNLOAD");

  async function loadReportCards() {
    setLoading(true);
    const res = await fetch("/api/teacher/report-cards");
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || t("teacherReportCards.couldNotLoad"));
      return;
    }
    setMentorSection(data.mentorSection);
    setSchemes(data.schemes || []);
    setCards(data.reportCards || []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReportCards();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function generateCards() {
    if (!examSchemeId) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/teacher/report-cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examSchemeId, classTeacherRemark: remark }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || t("teacherReportCards.couldNotGenerate"));
      return;
    }
    await loadReportCards();
  }

  async function publishCard(id: string) {
    const res = await fetch(`/api/teacher/report-cards/${id}/publish`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("teacherReportCards.couldNotPublish"));
      return;
    }
    await loadReportCards();
  }

  const filteredCards = examSchemeId
    ? cards.filter((card) => card.examScheme.id === examSchemeId)
    : cards;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("teacherReportCards.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("teacherReportCards.subtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !mentorSection ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Award className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="font-semibold text-gray-800">{t("teacherReportCards.noMentorSection")}</p>
            <p className="text-sm text-gray-500 mt-1">{t("teacherReportCards.noMentorSectionHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("teacherReportCards.generateDrafts")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("teacherReportCards.mentorSection")}</p>
                  <Input
                    value={mentorSection ? t("teacherReportCards.classSection", { className: mentorSection.class.name, sectionName: mentorSection.name }) : ""}
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("teacherReportCards.examScheme")}</p>
                  <Select value={examSchemeId} onValueChange={setExamSchemeId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("teacherReportCards.selectExamScheme")} />
                    </SelectTrigger>
                    <SelectContent>
                      {schemes.map((scheme) => (
                        <SelectItem key={scheme.id} value={scheme.id}>{scheme.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={generateCards} disabled={!examSchemeId || saving || !canGenerate} className="gap-2">
                  <Wand2 className="w-4 h-4" />
                  {saving ? t("teacherReportCards.generating") : t("teacherReportCards.generate")}
                </Button>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("teacherReportCards.classTeacherRemark")}</p>
                <Input
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder={t("teacherReportCards.remarkPlaceholder")}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("teacherReportCards.draftsAndPublished")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filteredCards.length === 0 ? (
                <p className="py-12 text-center text-sm text-gray-500">{t("teacherReportCards.noCardsYet")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="py-2 px-3 font-medium">{t("teacherReportCards.student")}</th>
                      <th className="py-2 px-3 font-medium">{t("teacherReportCards.exam")}</th>
                      <th className="py-2 px-3 font-medium">{t("teacherReportCards.total")}</th>
                      <th className="py-2 px-3 font-medium">{t("teacherReportCards.grade")}</th>
                      <th className="py-2 px-3 font-medium">{t("teacherReportCards.status")}</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.map((card) => (
                      <tr key={card.id} className="border-b border-gray-50">
                        <td className="py-3 px-3">
                          <p className="font-medium text-gray-900">{card.student.name}</p>
                          <p className="text-xs text-gray-400">{t("teacherReportCards.rollLabel", { roll: card.student.rollNo })}</p>
                        </td>
                        <td className="py-3 px-3 text-gray-600">{card.examScheme.name}</td>
                        <td className="py-3 px-3 text-gray-600">{card.totalMarks} ({card.percentage}%)</td>
                        <td className="py-3 px-3 font-semibold text-gray-900">{card.grade}</td>
                        <td className="py-3 px-3">
                          <Badge variant={card.status === "PUBLISHED" ? "default" : "secondary"}>{card.status}</Badge>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => setSubjectsCard(card)}
                            >
                              <ListTree className="w-4 h-4" />
                              Subjects
                            </Button>
                            {canDownload && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => window.open(`/api/teacher/report-cards/${card.id}/pdf`, "_blank")}
                              >
                                <Download className="w-4 h-4" />
                                {t("teacherReportCards.pdf")}
                              </Button>
                            )}
                            {card.status === "DRAFT" && canPublish && (
                              <Button size="sm" className="gap-2" onClick={() => publishCard(card.id)}>
                                <Send className="w-4 h-4" />
                                {t("teacherReportCards.publish")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!subjectsCard} onOpenChange={(open) => !open && setSubjectsCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {subjectsCard ? `${subjectsCard.student.name} – ${subjectsCard.examScheme.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          {subjectsCard && (
            <SubjectMarksTable
              subjects={subjectsCard.subjects}
              totalMarks={subjectsCard.totalMarks}
              percentage={subjectsCard.percentage}
              grade={subjectsCard.grade}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
