"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Megaphone, Plus, Trash2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  createdBy: { name: string };
}

export default function AnnouncementsPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`)
      .then((r) => r.json())
      .then((d) => {
        setSchoolId(d.id);
        fetchData(d.id);
      });
  }, [schoolSlug]);

  async function fetchData(sid: string) {
    setLoading(true);
    const res = await fetch(`/api/schools/${sid}/announcements`);
    setAnnouncements(await res.json());
    setLoading(false);
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      setError("Title and message are required");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setDialogOpen(false);
    setForm({ title: "", body: "" });
    fetchData(schoolId);
    setSaving(false);
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm("Delete this announcement?")) return;
    await fetch(`/api/schools/${schoolId}/announcements/${id}`, { method: "DELETE" });
    fetchData(schoolId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Announcements</h2>
          <p className="text-sm text-gray-500 mt-1">Post notices and circulars for your school</p>
        </div>
        <Button onClick={() => { setForm({ title: "", body: "" }); setError(""); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No announcements yet</p>
            <p className="text-gray-400 text-sm mt-1">Post notices, circulars, or event updates</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Megaphone className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{a.title}</p>
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(a.publishedAt), "dd MMM yyyy, h:mm a")}
                        </span>
                        <span>by {a.createdBy.name}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-red-600 flex-shrink-0"
                    onClick={() => deleteAnnouncement(a.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                placeholder="e.g. School closed on Friday"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Message *</Label>
              <textarea
                className="w-full min-h-[120px] px-3 py-2 rounded-md border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Write your announcement here..."
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Posting..." : "Post"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
