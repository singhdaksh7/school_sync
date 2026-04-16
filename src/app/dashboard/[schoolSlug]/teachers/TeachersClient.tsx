"use client";

import { useState, useRef } from "react";
import {
  Plus, Pencil, Trash2, Users, Search, Mail, Phone, BookOpen,
  Upload, Copy, Check, Link as LinkIcon, GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Section { id: string; name: string }
interface Class { id: string; name: string; sections: Section[] }
interface MentorSection { id: string; name: string; class: { name: string } }
interface Teacher {
  id: string; name: string; email: string | null; phone: string | null; subject: string | null;
  mentorSection: MentorSection | null; user: { id: string } | null; invites: { token: string }[];
}

const empty = { name: "", email: "", phone: "", subject: "", mentorSectionId: "" };

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

interface Props {
  initialTeachers: Teacher[];
  initialClasses: Class[];
  schoolId: string;
}

export default function TeachersClient({ initialTeachers, initialClasses, schoolId }: Props) {
  const [teachers, setTeachers] = useState<Teacher[]>(initialTeachers);
  const [classes] = useState<Class[]>(initialClasses);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [form, setForm] = useState(empty);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvResults, setCsvResults] = useState<{ name: string; success: boolean; inviteToken?: string; error?: string }[]>([]);
  const [csvLoading, setCsvLoading] = useState(false);

  async function fetchTeachers() {
    setLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/teachers`);
    setTeachers(await res.json());
    setLoading(false);
  }

  function openAdd() {
    setEditing(null); setForm(empty); setSelectedClassId(""); setError(""); setDialogOpen(true);
  }

  function openEdit(t: Teacher) {
    setEditing(t);
    setForm({ name: t.name, email: t.email || "", phone: t.phone || "", subject: t.subject || "", mentorSectionId: t.mentorSection?.id || "" });
    const cls = classes.find((c) => c.sections.some((s) => s.id === t.mentorSection?.id));
    setSelectedClassId(cls?.id || "");
    setError(""); setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const url = editing ? `/api/schools/${schoolId}/teachers/${editing.id}` : `/api/schools/${schoolId}/teachers`;
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, email: form.email, phone: form.phone, subject: form.subject,
        ...(editing ? { mentorSectionId: form.mentorSectionId || null } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    fetchTeachers();
    setSaving(false);
    if (!editing && data.inviteToken) {
      const origin = window.location.origin;
      setInviteLink(`${origin}/teacher-invite/${data.inviteToken}`);
      setInviteDialogOpen(true);
    }
  }

  async function deleteTeacher(id: string) {
    if (!confirm("Delete this teacher?")) return;
    await fetch(`/api/schools/${schoolId}/teachers/${id}`, { method: "DELETE" });
    fetchTeachers();
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function showExistingInvite(teacher: Teacher) {
    if (teacher.invites.length > 0) {
      const origin = window.location.origin;
      setInviteLink(`${origin}/teacher-invite/${teacher.invites[0].token}`);
      setCopied(false); setInviteDialogOpen(true);
    }
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { alert("No valid rows found. Make sure the CSV has a header row."); return; }
    setCsvLoading(true);
    const res = await fetch(`/api/schools/${schoolId}/teachers/bulk`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teachers: rows }),
    });
    const data = await res.json();
    setCsvLoading(false);
    setCsvResults(data.results || []);
    setCsvDialogOpen(true);
    fetchTeachers();
    if (fileRef.current) fileRef.current.value = "";
  }

  const filtered = teachers.filter(
    (t) => t.name.toLowerCase().includes(search.toLowerCase()) || (t.subject || "").toLowerCase().includes(search.toLowerCase())
  );

  const selectedClassSections = classes.find((c) => c.id === selectedClassId)?.sections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Teachers</h2>
          <p className="text-sm text-gray-500 mt-1">{teachers.length} teachers total</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2" disabled={csvLoading}>
            <Upload className="w-4 h-4" /> {csvLoading ? "Importing..." : "Import CSV"}
          </Button>
          <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add Teacher</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input className="pl-9" placeholder="Search teachers..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <p className="text-xs text-gray-400">
        CSV format: <code className="bg-gray-100 px-1 rounded">name,email,phone,subject</code> (header row required)
      </p>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">{search ? "No teachers found" : "No teachers yet"}</p>
            <p className="text-gray-400 text-sm mt-1">{!search && "Add your first teacher to get started"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <Card key={t.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-semibold text-sm">
                      {t.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{t.name}</p>
                      {t.subject && <Badge variant="secondary" className="mt-0.5 text-xs">{t.subject}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {t.invites.length > 0 && !t.user && (
                      <Button variant="ghost" size="icon" onClick={() => showExistingInvite(t)} title="View invite link" className="h-8 w-8 text-blue-400 hover:text-blue-600">
                        <LinkIcon className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} className="h-8 w-8 text-gray-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteTeacher(t.id)} className="h-8 w-8 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500">
                  {t.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{t.email}</div>}
                  {t.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{t.phone}</div>}
                  {t.subject && <div className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" />{t.subject}</div>}
                  {t.mentorSection && (
                    <div className="flex items-center gap-2 text-blue-600 font-medium">
                      <GraduationCap className="w-3.5 h-3.5" />
                      Mentor: Class {t.mentorSection.class.name} – Sec {t.mentorSection.name}
                    </div>
                  )}
                  {t.user && <Badge variant="outline" className="text-green-600 border-green-300 text-xs">Portal Active</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Teacher" : "Add Teacher"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            {[
              { id: "name", label: "Full Name *", placeholder: "Dr. John Smith", key: "name" as const },
              { id: "subject", label: "Subject", placeholder: "Mathematics", key: "subject" as const },
              { id: "email", label: "Email", placeholder: "teacher@school.edu", key: "email" as const },
              { id: "phone", label: "Phone", placeholder: "+91 98765 43210", key: "phone" as const },
            ].map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label htmlFor={f.id}>{f.label}</Label>
                <Input id={f.id} placeholder={f.placeholder} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              </div>
            ))}

            {editing && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-700 pt-1">Class Mentor Assignment</p>
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setForm((f) => ({ ...f, mentorSectionId: "" })); }}>
                    <SelectTrigger><SelectValue placeholder="Select class..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No assignment —</SelectItem>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {["Nursery", "LKG", "UKG"].includes(c.name) ? c.name : `Class ${c.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedClassId && selectedClassId !== "none" && (
                  <div className="space-y-1.5">
                    <Label>Section</Label>
                    <Select value={form.mentorSectionId} onValueChange={(v) => setForm((f) => ({ ...f, mentorSectionId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select section..." /></SelectTrigger>
                      <SelectContent>
                        {selectedClassSections.map((s) => (
                          <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(selectedClassId === "none" || !selectedClassId) && (
                  <p className="text-xs text-gray-400">Teacher will not be assigned as class mentor.</p>
                )}
              </div>
            )}

            {!editing && (
              <p className="text-xs text-gray-400 bg-blue-50 px-3 py-2 rounded border border-blue-100">
                If email is provided, an invite link will be generated so the teacher can set a password and access the portal.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Teacher"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Teacher Invite Link</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">Share this link with the teacher. They will use it to set their password and access the portal. The link is valid for <strong>30 days</strong>.</p>
            <div className="flex gap-2">
              <Input value={inviteLink} readOnly className="text-xs bg-gray-50 font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyLink(inviteLink)} title="Copy link">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {copied && <p className="text-xs text-green-600">Link copied to clipboard!</p>}
          </div>
          <DialogFooter><Button onClick={() => setInviteDialogOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>CSV Import Results</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2 py-2">
            {csvResults.map((r, i) => (
              <div key={i} className={`flex items-start justify-between px-3 py-2 rounded-lg text-sm ${r.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                <div>
                  <p className="font-medium">{r.name}</p>
                  {!r.success && r.error && <p className="text-xs mt-0.5 opacity-75">{r.error}</p>}
                  {r.success && r.inviteToken && <p className="text-xs mt-0.5 opacity-75">Invite link generated</p>}
                </div>
                <Badge variant={r.success ? "default" : "destructive"} className="text-xs ml-2 shrink-0">
                  {r.success ? "Added" : "Failed"}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">{csvResults.filter((r) => r.success).length} added, {csvResults.filter((r) => !r.success).length} failed</p>
          <DialogFooter><Button onClick={() => setCsvDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
