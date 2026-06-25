"use client";

import { useEffect, useState } from "react";
import { BookOpen, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Section { id: string; name: string }
interface Class { id: string; name: string; sections: Section[] }
interface Subject { id: string; name: string; classId: string; sectionId: string | null }

function classLabel(name: string) {
  return ["Nursery", "LKG", "UKG"].includes(name) ? name : `Class ${name}`;
}

export default function SubjectMasterClient({
  schoolId,
  classes,
}: {
  schoolId: string;
  classes: Class[];
}) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [sectionId, setSectionId] = useState<string>("whole-class");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const selectedClass = classes.find((c) => c.id === classId) ?? null;
  const effectiveSectionId = sectionId === "whole-class" ? null : sectionId;

  async function loadSubjects() {
    if (!classId) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ classId, raw: "1" });
    if (effectiveSectionId) params.set("sectionId", effectiveSectionId);
    const res = await fetch(`/api/schools/${schoolId}/subjects?${params.toString()}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Could not load subjects");
      return;
    }
    setSubjects(data);
  }

  useEffect(() => {
    void loadSubjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, sectionId, schoolId]);

  async function addSubject() {
    if (!newName.trim() || !classId) return;
    setAdding(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/subjects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, sectionId: effectiveSectionId ?? undefined, name: newName.trim() }),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setError(data.error || "Could not add subject");
      return;
    }
    setNewName("");
    void loadSubjects();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const res = await fetch(`/api/schools/${schoolId}/subjects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not rename subject");
      return;
    }
    setEditingId(null);
    void loadSubjects();
  }

  async function deleteSubject(id: string) {
    if (!confirm("Remove this subject from the master list?")) return;
    const res = await fetch(`/api/schools/${schoolId}/subjects/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete subject");
      return;
    }
    void loadSubjects();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Subject Master</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure subjects once per class — they&apos;ll auto-populate in timetable, homework, exams, and report cards.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Class</p>
              <Select value={classId} onValueChange={(v) => { setClassId(v); setSectionId("whole-class"); }}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{classLabel(c.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClass && selectedClass.sections.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Scope</p>
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whole-class">Whole class (all sections)</SelectItem>
                    {selectedClass.sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>Section {s.name} only</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {sectionId !== "whole-class" && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-2">
              This section has its own subject list, so the whole-class list above will be ignored for it. Add any
              shared subjects (e.g. English) here too if this section needs them.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <Card>
        <CardContent className="pt-5 pb-5 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Add a subject (e.g. Mathematics)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSubject(); }}
            />
            <Button onClick={addSubject} disabled={adding || !newName.trim()} className="gap-2">
              <Plus className="w-4 h-4" /> Add
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : subjects.length === 0 ? (
            <div className="py-10 text-center">
              <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No subjects added for this scope yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {subjects.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5">
                  {editingId === s.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.id); }}
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveEdit(s.id)}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400" onClick={() => setEditingId(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-gray-400 hover:text-blue-600"
                          onClick={() => { setEditingId(s.id); setEditName(s.name); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-gray-400 hover:text-red-600"
                          onClick={() => deleteSubject(s.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
