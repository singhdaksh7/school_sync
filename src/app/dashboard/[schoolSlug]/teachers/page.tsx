"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Pencil, Trash2, Users, Search, Mail, Phone, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Teacher { id: string; name: string; email: string | null; phone: string | null; subject: string | null }

const empty = { name: "", email: "", phone: "", subject: "" };

export default function TeachersPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetchTeachers(d.id);
    });
  }, [schoolSlug]);

  async function fetchTeachers(sid: string) {
    setLoading(true);
    const res = await fetch(`/api/schools/${sid}/teachers`);
    setTeachers(await res.json());
    setLoading(false);
  }

  function openAdd() { setEditing(null); setForm(empty); setError(""); setDialogOpen(true); }
  function openEdit(t: Teacher) { setEditing(t); setForm({ name: t.name, email: t.email || "", phone: t.phone || "", subject: t.subject || "" }); setError(""); setDialogOpen(true); }

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const url = editing
      ? `/api/schools/${schoolId}/teachers/${editing.id}`
      : `/api/schools/${schoolId}/teachers`;
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    fetchTeachers(schoolId);
    setSaving(false);
  }

  async function deleteTeacher(id: string) {
    if (!confirm("Delete this teacher?")) return;
    await fetch(`/api/schools/${schoolId}/teachers/${id}`, { method: "DELETE" });
    fetchTeachers(schoolId);
  }

  const filtered = teachers.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()) || (t.subject || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Teachers</h2>
          <p className="text-sm text-gray-500 mt-1">{teachers.length} teachers total</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add Teacher</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input className="pl-9" placeholder="Search teachers..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
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
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} className="h-8 w-8 text-gray-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteTeacher(t.id)} className="h-8 w-8 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500">
                  {t.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{t.email}</div>}
                  {t.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{t.phone}</div>}
                  {t.subject && <div className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" />{t.subject}</div>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Teacher"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
