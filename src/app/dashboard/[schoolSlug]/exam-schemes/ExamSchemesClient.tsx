"use client";

import { useState } from "react";
import { Plus, Trash2, FileText, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Exam { id: string; name: string; maxMarks: number; order: number }
interface Scheme { id: string; name: string; exams: Exam[] }

const emptyExam = { name: "", maxMarks: "" };

interface Props { initialSchemes: Scheme[]; schoolId: string }

export default function ExamSchemesClient({ initialSchemes, schoolId }: Props) {
  const [schemes, setSchemes] = useState<Scheme[]>(initialSchemes);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schemeName, setSchemeName] = useState("");
  const [exams, setExams] = useState([{ ...emptyExam }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchSchemes() {
    setLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/exam-schemes`);
    setSchemes(await res.json());
    setLoading(false);
  }

  function openAdd() { setSchemeName(""); setExams([{ ...emptyExam }]); setError(""); setDialogOpen(true); }
  function addExamRow() { setExams((prev) => [...prev, { ...emptyExam }]); }
  function removeExamRow(i: number) { setExams((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateExam(i: number, field: keyof typeof emptyExam, value: string) {
    setExams((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  }

  async function save() {
    if (!schemeName.trim()) { setError("Scheme name is required"); return; }
    const parsedExams = exams.map((e, i) => ({ name: e.name.trim(), maxMarks: parseInt(e.maxMarks, 10), order: i }));
    if (parsedExams.some((e) => !e.name || isNaN(e.maxMarks) || e.maxMarks < 1)) { setError("All exams must have a name and valid marks"); return; }
    setSaving(true); setError("");
    const res = await fetch(`/api/schools/${schoolId}/exam-schemes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: schemeName.trim(), exams: parsedExams }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    fetchSchemes();
    setSaving(false);
  }

  async function deleteScheme(id: string) {
    if (!confirm("Delete this exam scheme and all its results?")) return;
    await fetch(`/api/schools/${schoolId}/exam-schemes/${id}`, { method: "DELETE" });
    fetchSchemes();
  }

  const toggleExpand = (id: string) =>
    setExpanded((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Exam Schemes</h2>
          <p className="text-sm text-gray-500 mt-1">Define the exam structure for the academic year</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add Scheme</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />)}</div>
      ) : schemes.length === 0 ? (
        <Card><CardContent className="py-20 text-center"><FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">No exam schemes yet</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {schemes.map((scheme) => {
            const isOpen = expanded.includes(scheme.id);
            const totalMarks = scheme.exams.reduce((s, e) => s + e.maxMarks, 0);
            return (
              <Card key={scheme.id}>
                <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 rounded-xl" onClick={() => toggleExpand(scheme.id)}>
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center"><FileText className="w-4 h-4 text-amber-600" /></div>
                    <div>
                      <p className="font-semibold text-gray-900">{scheme.name}</p>
                      <p className="text-xs text-gray-400">{scheme.exams.length} exams · {totalMarks} total marks</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => deleteScheme(scheme.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                {isOpen && (
                  <CardContent className="pt-0 pb-4 px-5">
                    <div className="pl-11 space-y-2">
                      {scheme.exams.map((exam, i) => (
                        <div key={exam.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5">
                          <span className="w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center text-xs font-bold text-amber-700">{i + 1}</span>
                          <span className="font-medium text-gray-800 text-sm flex-1">{exam.name}</span>
                          <Badge variant="secondary" className="text-xs">Max: {exam.maxMarks} marks</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Exam Scheme</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto pr-1">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5"><Label>Scheme Name</Label><Input placeholder="e.g. Annual Exam 2024-25" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} /></div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Exams</Label>
                <Button type="button" variant="outline" size="sm" onClick={addExamRow} className="gap-1 h-7 text-xs"><Plus className="w-3 h-3" /> Add Exam</Button>
              </div>
              {exams.map((exam, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="text-xs font-semibold text-gray-400 w-5 shrink-0">{i + 1}.</span>
                  <Input placeholder="Exam name (e.g. Unit Test 1)" value={exam.name} onChange={(e) => updateExam(i, "name", e.target.value)} className="flex-1" />
                  <Input type="number" placeholder="Max" min={1} value={exam.maxMarks} onChange={(e) => updateExam(i, "maxMarks", e.target.value)} className="w-20 text-center" />
                  <span className="text-xs text-gray-400 shrink-0">marks</span>
                  {exams.length > 1 && <button onClick={() => removeExamRow(i)} className="text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Creating..." : "Create Scheme"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
