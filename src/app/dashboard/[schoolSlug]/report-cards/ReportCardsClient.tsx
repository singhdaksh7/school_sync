"use client";

import { useState } from "react";
import { Download, FileText, Search, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SubjectMarksTable, { type SubjectMark } from "@/components/shared/SubjectMarksTable";

type Section = { id: string; name: string; className: string };
type Scheme = { id: string; name: string };
type ReportCard = {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  totalMarks: number;
  percentage: number;
  grade: string;
  publishedAt: string | null;
  student: { name: string; rollNo: string; section: { name: string; class: { name: string } } };
  examScheme: { id: string; name: string };
  generatedByTeacher: { name: string };
  subjects: SubjectMark[];
};

export default function ReportCardsClient({
  schoolId,
  sections,
  schemes,
}: {
  schoolId: string;
  sections: Section[];
  schemes: Scheme[];
}) {
  const [sectionId, setSectionId] = useState("all");
  const [examSchemeId, setExamSchemeId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subjectsCard, setSubjectsCard] = useState<ReportCard | null>(null);

  async function fetchCards() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (sectionId !== "all") params.set("sectionId", sectionId);
    if (examSchemeId !== "all") params.set("examSchemeId", examSchemeId);
    if (status !== "all") params.set("status", status);

    const res = await fetch(`/api/schools/${schoolId}/report-cards?${params.toString()}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Could not load report cards");
      return;
    }
    setCards(data.reportCards || []);
  }

  const filteredCards = cards.filter((card) => {
    const text = `${card.student.name} ${card.student.rollNo} ${card.examScheme.name}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const publishedCount = cards.filter((card) => card.status === "PUBLISHED").length;
  const draftCount = cards.filter((card) => card.status === "DRAFT").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Report Cards</h2>
        <p className="text-sm text-gray-500 mt-1">Monitor final report card drafts and published cards.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Section</p>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.className} - {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Exam Scheme</p>
              <Select value={examSchemeId} onValueChange={setExamSchemeId}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schemes</SelectItem>
                  {schemes.map((scheme) => (
                    <SelectItem key={scheme.id} value={scheme.id}>{scheme.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={fetchCards} disabled={loading} className="gap-2">
              <FileText className="w-4 h-4" />
              {loading ? "Loading..." : "Load Cards"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5 pb-5"><p className="text-sm text-gray-500">Total Cards</p><p className="mt-1 text-3xl font-bold">{cards.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-5"><p className="text-sm text-gray-500">Published</p><p className="mt-1 text-3xl font-bold text-green-700">{publishedCount}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-5"><p className="text-sm text-gray-500">Drafts</p><p className="mt-1 text-3xl font-bold text-yellow-700">{draftCount}</p></CardContent></Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input className="pl-9" placeholder="Search student or exam..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Report Card Monitoring</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredCards.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">No report cards loaded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-2 px-3 font-medium">Student</th>
                  <th className="py-2 px-3 font-medium">Section</th>
                  <th className="py-2 px-3 font-medium">Exam</th>
                  <th className="py-2 px-3 font-medium">Mentor</th>
                  <th className="py-2 px-3 font-medium">Score</th>
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
                    <td className="py-3 px-3 text-gray-600">{card.student.section.class.name}-{card.student.section.name}</td>
                    <td className="py-3 px-3 text-gray-600">{card.examScheme.name}</td>
                    <td className="py-3 px-3 text-gray-600">{card.generatedByTeacher.name}</td>
                    <td className="py-3 px-3 text-gray-600">{card.totalMarks} ({card.percentage}%) · {card.grade}</td>
                    <td className="py-3 px-3"><Badge variant={card.status === "PUBLISHED" ? "default" : "secondary"}>{card.status}</Badge></td>
                    <td className="py-3 px-3 text-right">
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
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => window.open(`/api/schools/${schoolId}/report-cards/${card.id}/pdf`, "_blank")}
                        >
                          <Download className="w-4 h-4" />
                          PDF
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

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
