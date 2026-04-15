"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Trash2, GraduationCap, Search, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface Section { id: string; name: string; class: { id: string; name: string } }
interface Student { id: string; name: string; rollNo: string; email: string | null; phone: string | null; parentName: string | null; parentPhone: string | null; sectionId: string; section: { name: string; class: { name: string } } }

const empty = { name: "", rollNo: "", sectionId: "", email: "", phone: "", parentName: "", parentPhone: "" };

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

export default function StudentsPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSection, setFilterSection] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvResults, setCsvResults] = useState<{ name: string; success: boolean; error?: string }[]>([]);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetchData(d.id);
    });
  }, [schoolSlug]);

  async function fetchData(sid: string) {
    setLoading(true);
    const [studentsRes, classesRes] = await Promise.all([
      fetch(`/api/schools/${sid}/students`),
      fetch(`/api/schools/${sid}/classes`),
    ]);
    const studentsData = await studentsRes.json();
    const classesData = await classesRes.json();
    setStudents(studentsData);
    const allSections: Section[] = classesData.flatMap((c: any) =>
      c.sections.map((s: any) => ({ id: s.id, name: s.name, class: { id: c.id, name: c.name } }))
    );
    setSections(allSections);
    setLoading(false);
  }

  function openAdd() { setEditing(null); setForm(empty); setError(""); setDialogOpen(true); }
  function openEdit(s: Student) {
    setEditing(s);
    setForm({ name: s.name, rollNo: s.rollNo, sectionId: s.sectionId, email: s.email || "", phone: s.phone || "", parentName: s.parentName || "", parentPhone: s.parentPhone || "" });
    setError(""); setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.rollNo.trim() || !form.sectionId) { setError("Name, roll no., and section are required"); return; }
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
    fetchData(schoolId);
    setSaving(false);
  }

  async function deleteStudent(id: string) {
    if (!confirm("Delete this student?")) return;
    await fetch(`/api/schools/${schoolId}/students/${id}`, { method: "DELETE" });
    fetchData(schoolId);
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { alert("No valid rows found. Check CSV has a header row."); return; }
    setCsvLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/students/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ students: rows }),
    });
    const data = await res.json();
    setCsvLoading(false);
    setCsvResults(data.results || []);
    setCsvDialogOpen(true);
    fetchData(schoolId);
    if (fileRef.current) fileRef.current.value = "";
  }

  const filtered = students.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.rollNo.toLowerCase().includes(search.toLowerCase());
    const matchSection = filterSection === "all" || s.sectionId === filterSection;
    return matchSearch && matchSection;
  });

  // Group by class-section
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
        <div className="text-center py-20 text-gray-400">Loading...</div>
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
                          <Button variant="ghost" size="icon" onClick={() => deleteStudent(s.id)} className="h-7 w-7 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                      {(s.parentName || s.parentPhone) && (
                        <p className="text-xs text-gray-400 mt-1">Parent: {s.parentName} {s.parentPhone && `· ${s.parentPhone}`}</p>
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
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="Ravi Kumar" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Roll Number *</Label>
              <Input placeholder="101" value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Parent Name</Label>
                <Input placeholder="Suresh Kumar" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Parent Phone</Label>
                <Input placeholder="+91 98765 43210" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="student@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Student"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import Results Dialog */}
      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>CSV Import Results</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-1.5 py-2">
            {csvResults.map((r, i) => (
              <div key={i} className={`flex items-start justify-between px-3 py-2 rounded-lg text-sm ${r.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                <div>
                  <p className="font-medium">{r.name}</p>
                  {!r.success && r.error && <p className="text-xs mt-0.5 opacity-75">{r.error}</p>}
                </div>
                <Badge variant={r.success ? "default" : "destructive"} className="text-xs ml-2 shrink-0">
                  {r.success ? "Added" : "Failed"}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {csvResults.filter((r) => r.success).length} added, {csvResults.filter((r) => !r.success).length} failed
          </p>
          <p className="text-xs text-gray-400 bg-blue-50 px-3 py-2 rounded border border-blue-100">
            CSV format: <code>name,rollno,class,section,email,phone,parentname,parentphone</code>
          </p>
          <DialogFooter>
            <Button onClick={() => setCsvDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
