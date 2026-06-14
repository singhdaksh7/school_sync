"use client";

import { useEffect, useState } from "react";
import { Award, Download, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

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
  subjects: { id: string; subject: string; marks: number; maxMarks: number; grade: string }[];
};

export default function TeacherReportCardsPage() {
  const [mentorSection, setMentorSection] = useState<MentorSection | null>(null);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [examSchemeId, setExamSchemeId] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadReportCards() {
    setLoading(true);
    const res = await fetch("/api/teacher/report-cards");
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Could not load report cards");
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
      setError(data.error || "Could not generate report cards");
      return;
    }
    await loadReportCards();
  }

  async function publishCard(id: string) {
    const res = await fetch(`/api/teacher/report-cards/${id}/publish`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not publish report card");
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
        <h1 className="text-2xl font-bold text-gray-900">Report Cards</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate and publish final report cards for your mentor section.
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
            <p className="font-semibold text-gray-800">No mentor section assigned</p>
            <p className="text-sm text-gray-500 mt-1">Only class mentors can generate final report cards.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate Drafts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Mentor Section</p>
                  <Input
                    value={mentorSection ? `Class ${mentorSection.class.name} - Section ${mentorSection.name}` : ""}
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Exam Scheme</p>
                  <Select value={examSchemeId} onValueChange={setExamSchemeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select exam scheme" />
                    </SelectTrigger>
                    <SelectContent>
                      {schemes.map((scheme) => (
                        <SelectItem key={scheme.id} value={scheme.id}>{scheme.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={generateCards} disabled={!examSchemeId || saving} className="gap-2">
                  <Wand2 className="w-4 h-4" />
                  {saving ? "Generating..." : "Generate"}
                </Button>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Class Teacher Remark</p>
                <Input
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="Optional remark for generated cards"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Drafts and Published Cards</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filteredCards.length === 0 ? (
                <p className="py-12 text-center text-sm text-gray-500">No report cards generated yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="py-2 px-3 font-medium">Student</th>
                      <th className="py-2 px-3 font-medium">Exam</th>
                      <th className="py-2 px-3 font-medium">Total</th>
                      <th className="py-2 px-3 font-medium">Grade</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.map((card) => (
                      <tr key={card.id} className="border-b border-gray-50">
                        <td className="py-3 px-3">
                          <p className="font-medium text-gray-900">{card.student.name}</p>
                          <p className="text-xs text-gray-400">Roll {card.student.rollNo}</p>
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
                              onClick={() => window.open(`/api/teacher/report-cards/${card.id}/pdf`, "_blank")}
                            >
                              <Download className="w-4 h-4" />
                              PDF
                            </Button>
                            {card.status === "DRAFT" && (
                              <Button size="sm" className="gap-2" onClick={() => publishCard(card.id)}>
                                <Send className="w-4 h-4" />
                                Publish
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
    </div>
  );
}
