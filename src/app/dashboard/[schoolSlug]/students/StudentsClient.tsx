"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, GraduationCap, Search, Upload, ExternalLink, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { parseCSV } from "@/lib/csv-parse";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface Section { id: string; name: string; class: { id: string; name: string } }
interface ClassWithSections { id: string; name: string; sections: { id: string; name: string }[] }
interface Student {
  id: string; name: string; admissionNo: string | null; rollNo: string; email: string | null; phone: string | null;
  fatherName: string | null; fatherPhone: string | null;
  motherName: string | null; motherPhone: string | null;
  sectionId: string;
  section: { name: string; class: { name: string } }
}

const empty = {
  name: "", admissionNo: "", rollNo: "", sectionId: "", email: "", phone: "",
  fatherName: "", fatherPhone: "", motherName: "", motherPhone: "",
};

interface Props {
  initialStudents: Student[];
  initialSections: Section[];
  schoolId: string;
  schoolSlug: string;
}

export default function StudentsClient({ initialStudents, initialSections, schoolId, schoolSlug }: Props) {
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterSection, setFilterSection] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvResults, setCsvResults] = useState<{ name: string; success: boolean; error?: string }[]>([]);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const [studentsRes, classesRes] = await Promise.all([
        fetch(`/api/schools/${schoolId}/students?limit=500`),
        fetch(`/api/schools/${schoolId}/classes`),
      ]);
      if (!studentsRes.ok || !classesRes.ok) throw new Error("Failed to refresh students");
      const studentsData = await studentsRes.json();
      const classesData = await classesRes.json();
      setStudents(studentsData.data ?? studentsData);
      const allSections: Section[] = (classesData as ClassWithSections[]).flatMap((c) =>
        c.sections.map((s) => ({ id: s.id, name: s.name, class: { id: c.id, name: c.name } }))
      );
      setSections(allSections);
      setRefreshError("");
    } catch {
      setRefreshError("Could not refresh the student list. Please reload the page.");
    } finally {
      setLoading(false);
    }
  }

  function openAdd() { setEditing(null); setForm(empty); setError(""); setDialogOpen(true); }
  function openEdit(s: Student) {
    setEditing(s);
    setForm({
      name: s.name, admissionNo: s.admissionNo || "", rollNo: s.rollNo, sectionId: s.sectionId,
      email: s.email || "", phone: s.phone || "",
      fatherName: s.fatherName || "", fatherPhone: s.fatherPhone || "",
      motherName: s.motherName || "", motherPhone: s.motherPhone || "",
    });
    setError(""); setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.admissionNo.trim() || !form.rollNo.trim() || !form.sectionId) {
      setError("Name, admission number, roll no., and section are required");
      return;
    }
    if (!form.fatherPhone.trim() && !form.motherPhone.trim()) {
      setError("Father Phone or Mother Phone is required so the student can log in");
      return;
    }
    setSaving(true); setError("");
    const url = editing ? `/api/schools/${schoolId}/students/${editing.id}` : `/api/schools/${schoolId}/students`;
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    setSaving(false);
    // Reflect the saved record immediately; the response has the same nested
    // shape the list renders, so this beats waiting on the network round-trip.
    setStudents((prev) =>
      editing ? prev.map((s) => (s.id === data.id ? data : s)) : [...prev, data]
    );
    void fetchData();
  }

  async function deleteStudent(id: string) {
    setStudents((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/schools/${schoolId}/students/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setRefreshError("Could not delete the student. Please try again.");
    }
    void fetchData();
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text, { normalizeHeaderWhitespace: true });
    if (rows.length === 0) { alert("No valid rows found. Check CSV has a header row."); return; }
    setCsvLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/students/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ students: rows }),
    });
    const data = await res.json();
    setCsvLoading(false);
    if (res.status === 202 && data.mode === "job") {
      setCsvResults([{ name: `Import of ${data.totalItems} students queued (job ${data.jobId})`, success: true }]);
    } else if (!res.ok) {
      setCsvResults([{ name: data.error || "Import failed", success: false, error: data.error }]);
    } else {
      setCsvResults(data.results || []);
    }
    setCsvDialogOpen(true);
    fetchData();
    if (fileRef.current) fileRef.current.value = "";
  }

  const filtered = students.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.rollNo.toLowerCase().includes(search.toLowerCase());
    const matchSection = filterSection === "all" || s.sectionId === filterSection;
    return matchSearch && matchSection;
  });

  const grouped = filtered.reduce((acc, s) => {
    const key = `${s.section.class.name} - Section ${s.section.name}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {} as Record<string, Student[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Students</h2>
          <p className="text-sm text-gray-500 mt-1">{students.length} students enrolled</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2" disabled={csvLoading || sections.length === 0}>
            <Upload className="w-4 h-4" /> {csvLoading ? "Importing..." : "Import CSV"}
          </Button>
          <Button onClick={openAdd} className="gap-2" disabled={sections.length === 0}>
            <Plus className="w-4 h-4" /> Add Student
          </Button>
        </div>
      </div>

      {refreshError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {refreshError}
        </div>
      )}

      {sections.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-3 rounded-lg">
          You need to create classes and sections before adding students.
        </div>
      )}

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search by name or roll no..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterSection} onValueChange={setFilterSection}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.class.name} - {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <GraduationCap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">{search ? "No students found" : "No students yet"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([group, groupStudents]) => (
            <div key={group}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{group}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groupStudents.map((s) => (
                  <Card key={s.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-semibold text-sm flex-shrink-0">
                            {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{s.name}</p>
                            <Badge variant="outline" className="text-xs mt-0.5">Roll: {s.rollNo}</Badge>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Link href={`/dashboard/${schoolSlug}/students/${s.id}`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-purple-600" title="View profile"><ExternalLink className="w-3 h-3" /></Button>
                          </Link>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(s)} className="h-7 w-7 text-gray-400 hover:text-blue-600"><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { setStudentToDelete(s.id); setDeleteConfirmOpen(true); }} className="h-7 w-7 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                      {s.admissionNo && (
                        <p className="text-xs text-gray-400 mt-1">Admission No: {s.admissionNo}</p>
                      )}
                      {(s.fatherName || s.fatherPhone) && (
                        <p className="text-xs text-gray-400 mt-0.5">Father: {s.fatherName} {s.fatherPhone && `· ${s.fatherPhone}`}</p>
                      )}
                      {(s.motherName || s.motherPhone) && (
                        <p className="text-xs text-gray-400 mt-0.5">Mother: {s.motherName} {s.motherPhone && `· ${s.motherPhone}`}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Student" : "Add Student"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <p className="text-sm font-semibold text-gray-700">Student Information</p>
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="Ravi Kumar" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Admission Number *</Label>
                <Input placeholder="ADM-001" value={form.admissionNo} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Roll Number *</Label>
                <Input placeholder="101" value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Class & Section *</Label>
              <Select value={form.sectionId} onValueChange={(v) => setForm({ ...form, sectionId: v })}>
                <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.class.name} - Section {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="student@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>

            <div className="pt-1 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 pt-3">Parent Information</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Father Phone or Mother Phone becomes the student&apos;s login password — at least one is required.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Father Name</Label>
                <Input placeholder="Suresh Kumar" value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Father Phone</Label>
                <Input placeholder="+91 98765 43210" value={form.fatherPhone} onChange={(e) => setForm({ ...form, fatherPhone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mother Name</Label>
                <Input placeholder="Anita Kumar" value={form.motherName} onChange={(e) => setForm({ ...form, motherName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Mother Phone</Label>
                <Input placeholder="+91 98765 43210" value={form.motherPhone} onChange={(e) => setForm({ ...form, motherPhone: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Student"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>CSV Import Summary</DialogTitle>
          </DialogHeader>
          
          {/* Summary metrics bar */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Successful</p>
                <p className="text-lg font-bold text-foreground">{csvResults.filter((r) => r.success).length} rows added</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Failed</p>
                <p className="text-lg font-bold text-foreground">{csvResults.filter((r) => !r.success).length} rows failed</p>
              </div>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-4 py-2 pr-1">
            {/* Failures List (if any) */}
            {csvResults.some(r => !r.success) && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-red-700 uppercase tracking-wider">Errors & Failed Rows</p>
                <div className="space-y-1.5">
                  {csvResults.filter(r => !r.success).map((r, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-red-900">{r.name}</p>
                        {r.error && <p className="text-xs text-red-700 mt-1 font-medium bg-white/70 px-2.5 py-1.5 rounded border border-red-100">{r.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Success List (if any) */}
            {csvResults.some(r => r.success) && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-green-700 uppercase tracking-wider">Successfully Imported</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {csvResults.filter(r => r.success).map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50/30 px-3 py-2 text-xs text-green-800">
                      <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="font-medium truncate">{r.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-800">
            <span className="font-bold">Required CSV columns:</span> <code>name, admissionno, rollno, class, section, email, phone, fathername, fatherphone, mothername, motherphone</code>
            <br />
            <span className="font-semibold mt-1 block">Authentication rule:</span> Each row must provide at least one of <code>fatherphone</code> or <code>motherphone</code> to generate parental/student portal login credentials.
          </div>
          <DialogFooter>
            <Button onClick={() => setCsvDialogOpen(false)} className="w-full sm:w-auto">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Student"
        description="Are you sure you want to delete this student? All their academic results, attendance logs, and homework submissions will be permanently deleted. This action cannot be undone."
        confirmText="Delete Student"
        cancelText="Cancel"
        isDestructive
        onConfirm={() => {
          if (studentToDelete) {
            void deleteStudent(studentToDelete);
          }
        }}
      />
    </div>
  );
}
