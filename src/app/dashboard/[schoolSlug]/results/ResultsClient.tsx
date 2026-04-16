"use client";

import { useEffect, useState, useCallback } from "react";
import { FileText, Save, TrendingUp, Award, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Exam { id: string; name: string; maxMarks: number; order: number }
interface Scheme { id: string; name: string; exams: Exam[] }
interface Section { id: string; name: string; class: { name: string } }
interface Student { id: string; name: string; rollNo: string; sectionId: string }
interface ResultEntry { studentId: string; examId: string; marks: number }

interface Props {
  initialSchemes: Scheme[];
  initialSections: Section[];
  schoolId: string;
}

export default function ResultsClient({ initialSchemes, initialSections, schoolId }: Props) {
  const [schemes] = useState<Scheme[]>(initialSchemes);
  const [sections] = useState<Section[]>(initialSections);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedScheme, setSelectedScheme] = useState<Scheme | null>(null);
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedSection) return;
    fetch(`/api/schools/${schoolId}/students?sectionId=${selectedSection}`)
      .then((r) => r.json()).then(setStudents);
  }, [schoolId, selectedSection]);

  const loadResults = useCallback(async (schemeId: string, sectionId: string) => {
    if (!schemeId || !sectionId) return;
    setLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/exam-schemes/${schemeId}/results?sectionId=${sectionId}`);
    const data = await res.json();
    const flat: Record<string, number> = {};
    data.forEach((r: ResultEntry & { exam: { id: string } }) => {
      flat[`${r.studentId}_${r.examId}`] = r.marks;
    });
    setExisting(flat);
    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    if (selectedScheme && selectedSection) {
      loadResults(selectedScheme.id, selectedSection);
      setMarks({});
    }
  }, [selectedScheme, selectedSection, loadResults]);

  useEffect(() => {
    if (!selectedExam) return;
    const prefilled: Record<string, string> = {};
    students.forEach((s) => {
      const key = `${s.id}_${selectedExam.id}`;
      if (existing[key] !== undefined) prefilled[s.id] = String(existing[key]);
    });
    setMarks(prefilled);
  }, [selectedExam, existing, students]);

  async function saveMarks() {
    if (!selectedScheme || !selectedExam || !selectedSection) return;
    const results = students.map((s) => ({
      studentId: s.id,
      marks: marks[s.id] !== "" && marks[s.id] !== undefined ? parseFloat(marks[s.id]) : null,
    })).filter((r) => r.marks !== null && !isNaN(r.marks as number));
    setSaving(true);
    const res = await fetch(`/api/schools/${schoolId}/exam-schemes/${selectedScheme.id}/results`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId: selectedExam.id, results }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); loadResults(selectedScheme.id, selectedSection); }
  }

  const enteredMarks = students.map((s) => parseFloat(marks[s.id] ?? "")).filter((m) => !isNaN(m));
  const avg = enteredMarks.length > 0 ? (enteredMarks.reduce((a, b) => a + b, 0) / enteredMarks.length).toFixed(1) : null;
  const highest = enteredMarks.length > 0 ? Math.max(...enteredMarks) : null;
  const passCount = selectedExam ? enteredMarks.filter((m) => m >= selectedExam.maxMarks * 0.33).length : 0;

  const allExamsSummary = selectedScheme && selectedSection && students.length > 0
    ? students.map((s) => {
        const total = selectedScheme.exams.reduce((sum, e) => sum + (existing[`${s.id}_${e.id}`] ?? 0), 0);
        const maxTotal = selectedScheme.exams.reduce((sum, e) => sum + e.maxMarks, 0);
        const filled = selectedScheme.exams.filter((e) => existing[`${s.id}_${e.id}`] !== undefined).length;
        return { student: s, total, maxTotal, filled, exams: selectedScheme.exams.length };
      }).sort((a, b) => b.total - a.total)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Results</h2>
        <p className="text-sm text-gray-500 mt-1">View and enter exam marks for students</p>
      </div>

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Exam Scheme</p>
              <Select value={selectedScheme?.id || ""} onValueChange={(v) => { const s = schemes.find((s) => s.id === v) || null; setSelectedScheme(s); setSelectedExam(null); setMarks({}); setExisting({}); }}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Select scheme" /></SelectTrigger>
                <SelectContent>{schemes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section</p>
              <Select value={selectedSection} onValueChange={(v) => { setSelectedSection(v); setSelectedExam(null); setMarks({}); }}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Select section" /></SelectTrigger>
                <SelectContent>{sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.class.name} - Section {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedScheme && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Exam (for entry)</p>
                <Select value={selectedExam?.id || ""} onValueChange={(v) => { const e = selectedScheme.exams.find((e) => e.id === v) || null; setSelectedExam(e); }}>
                  <SelectTrigger className="w-52"><SelectValue placeholder="Select exam" /></SelectTrigger>
                  <SelectContent>{selectedScheme.exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (/{e.maxMarks})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedScheme || !selectedSection ? (
        <Card><CardContent className="py-20 text-center"><FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">Select a scheme and section to view results</p></CardContent></Card>
      ) : loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-lg" />)}</div>
      ) : (
        <>
          {allExamsSummary.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />Overall Summary — {selectedScheme.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Student</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Roll No</th>
                      {selectedScheme.exams.map((e) => (
                        <th key={e.id} className="text-center py-2 px-3 text-gray-500 font-medium whitespace-nowrap">
                          {e.name}<br /><span className="font-normal text-xs text-gray-400">/{e.maxMarks}</span>
                        </th>
                      ))}
                      <th className="text-center py-2 px-3 text-gray-500 font-medium">Total</th>
                      <th className="text-center py-2 px-3 text-gray-500 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allExamsSummary.map(({ student, total, maxTotal, filled }) => {
                      const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
                      return (
                        <tr key={student.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 px-3 font-medium text-gray-900">{student.name}</td>
                          <td className="py-2.5 px-3 text-gray-500">{student.rollNo}</td>
                          {selectedScheme.exams.map((e) => {
                            const val = existing[`${student.id}_${e.id}`];
                            return <td key={e.id} className="py-2.5 px-3 text-center">{val !== undefined ? <span className={cn("font-medium", val >= e.maxMarks * 0.33 ? "text-gray-900" : "text-red-600")}>{val}</span> : <span className="text-gray-300">—</span>}</td>;
                          })}
                          <td className="py-2.5 px-3 text-center font-semibold text-gray-900">{filled > 0 ? `${total}/${maxTotal}` : "—"}</td>
                          <td className="py-2.5 px-3 text-center">
                            {filled > 0 ? (
                              <Badge variant={pct >= 33 ? "default" : "destructive"} className={cn("text-xs", pct >= 60 ? "bg-green-100 text-green-700 hover:bg-green-100" : pct >= 33 ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100" : "")}>{pct}%</Badge>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {selectedExam && students.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-500" />
                    Enter Marks — {selectedExam.name}
                    <span className="text-gray-400 font-normal text-sm">(max {selectedExam.maxMarks})</span>
                  </div>
                  <Button onClick={saveMarks} disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" />{saving ? "Saving..." : saved ? "Saved!" : "Save Marks"}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {avg !== null && (
                  <div className="flex gap-4 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <span className="text-xs text-blue-700 font-medium">Average: {avg}</span>
                    <span className="text-xs text-blue-700 font-medium">Highest: {highest}</span>
                    <span className="text-xs text-blue-700 font-medium">Pass ({enteredMarks.length > 0 ? Math.round(passCount / enteredMarks.length * 100) : 0}%): {passCount}/{enteredMarks.length}</span>
                  </div>
                )}
                <div className="space-y-2">
                  {students.map((student) => {
                    const val = parseFloat(marks[student.id] ?? "");
                    const isOver = !isNaN(val) && val > selectedExam.maxMarks;
                    const isFail = !isNaN(val) && val < selectedExam.maxMarks * 0.33;
                    return (
                      <div key={student.id} className="flex items-center gap-4 py-2.5 px-4 rounded-lg border border-gray-100 hover:bg-gray-50">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700 shrink-0">
                          {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{student.name}</p>
                          <p className="text-xs text-gray-400">Roll: {student.rollNo}</p>
                        </div>
                        {existing[`${student.id}_${selectedExam.id}`] !== undefined && (
                          <Badge variant="secondary" className="text-xs">saved: {existing[`${student.id}_${selectedExam.id}`]}</Badge>
                        )}
                        {isOver && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" min={0} max={selectedExam.maxMarks} step={0.5}
                            className={cn("w-20 text-center h-8", isOver ? "border-red-400" : isFail && !isNaN(val) ? "border-yellow-400" : "")}
                            placeholder="—" value={marks[student.id] ?? ""}
                            onChange={(e) => setMarks((prev) => ({ ...prev, [student.id]: e.target.value }))}
                          />
                          <span className="text-xs text-gray-400 shrink-0">/ {selectedExam.maxMarks}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={saveMarks} disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" />{saving ? "Saving..." : saved ? "Saved!" : "Save Marks"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {students.length === 0 && (
            <Card><CardContent className="py-16 text-center"><p className="text-gray-400">No students in this section.</p></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}
