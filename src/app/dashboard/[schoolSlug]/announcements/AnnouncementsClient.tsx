"use client";

import { useMemo, useState } from "react";
import { Megaphone, Plus, Search, Calendar, Clock, Archive, Ban, Send, Pencil, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Status = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED" | "CANCELLED";
type Scope = "SCHOOL_WIDE" | "CLASS_SECTION";
type AudienceGroup = "TEACHERS" | "GUARDIANS" | "STUDENTS";

interface Announcement {
  id: string;
  title: string;
  body: string;
  status: Status;
  scope: Scope;
  publishedAt: string | null;
  scheduledAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: { name: string; role?: string };
  audience: { group: AudienceGroup }[];
  targets: { classId: string; sectionId: string; class: { name: string }; section: { name: string } }[];
  correctionCount?: number;
}

interface SchoolClass {
  id: string;
  name: string;
  sections: { id: string; name: string }[];
}

interface Props {
  initialAnnouncements: Announcement[];
  initialSummary: Record<string, number>;
  classes: SchoolClass[];
  schoolId: string;
}

const STATUS_BADGE: Record<Status, "secondary" | "warning" | "success" | "outline" | "destructive"> = {
  DRAFT: "secondary",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "outline",
  CANCELLED: "destructive",
};

const EMPTY_FORM = {
  title: "",
  body: "",
  scope: "SCHOOL_WIDE" as Scope,
  audience: [] as AudienceGroup[],
  targets: [] as { classId: string; sectionId: string }[],
  scheduledAt: "",
  expiresAt: "",
  publishNow: false,
};

export default function AnnouncementsClient({ initialAnnouncements, initialSummary, classes, schoolId }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [scopeFilter, setScopeFilter] = useState<string>("ALL");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<Status | null>(null);
  const [correctionConfirmOpen, setCorrectionConfirmOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{ id: string; action: "cancel" | "archive" | "publish" } | null>(null);
  const [statsFor, setStatsFor] = useState<{ id: string; title: string } | null>(null);
  const [stats, setStats] = useState<Record<string, { eligible: number; read: number }> | null>(null);

  async function fetchData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/schools/${schoolId}/announcements?limit=100`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load announcements");
      setAnnouncements(body.data ?? []);
      if (body.summary) setSummary(body.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return announcements.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (scopeFilter !== "ALL" && a.scope !== scopeFilter) return false;
      if (search && !`${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [announcements, search, statusFilter, scopeFilter]);

  function openCreate() {
    setEditingId(null);
    setEditingStatus(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setDialogOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditingId(a.id);
    setEditingStatus(a.status);
    setForm({
      title: a.title,
      body: a.body,
      scope: a.scope,
      audience: a.audience.map((x) => x.group),
      targets: a.targets.map((t) => ({ classId: t.classId, sectionId: t.sectionId })),
      scheduledAt: a.scheduledAt ? a.scheduledAt.slice(0, 16) : "",
      expiresAt: a.expiresAt ? a.expiresAt.slice(0, 16) : "",
      publishNow: false,
    });
    setFormError("");
    setDialogOpen(true);
  }

  function toggleAudience(group: AudienceGroup) {
    setForm((f) => ({ ...f, audience: f.audience.includes(group) ? f.audience.filter((g) => g !== group) : [...f.audience, group] }));
  }

  function applyTeachersParentsPreset() {
    setForm((f) => ({ ...f, audience: ["TEACHERS", "GUARDIANS"] }));
  }

  function toggleSection(classId: string, sectionId: string) {
    setForm((f) => {
      const exists = f.targets.some((t) => t.sectionId === sectionId);
      return { ...f, targets: exists ? f.targets.filter((t) => t.sectionId !== sectionId) : [...f.targets, { classId, sectionId }] };
    });
  }

  async function submitCorrection() {
    if (!editingId) return;
    setSaving(true);
    setFormError("");
    const res = await fetch(`/api/schools/${schoolId}/announcements/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "correct", title: form.title.trim(), body: form.body.trim(), expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error ?? "Failed to save correction");
      setSaving(false);
      return;
    }
    setDialogOpen(false);
    setCorrectionConfirmOpen(false);
    setSaving(false);
    fetchData();
  }

  async function save(publishNow: boolean) {
    if (!form.title.trim() || !form.body.trim()) {
      setFormError("Title and message are required");
      return;
    }

    // A published announcement is edited via the audited correction workflow
    // (title/body/expiry only — scope/audience/targets are locked once live)
    // rather than the regular draft/scheduled update path.
    if (editingStatus === "PUBLISHED") {
      setCorrectionConfirmOpen(true);
      return;
    }

    if (form.audience.length === 0) {
      setFormError("Select at least one audience group");
      return;
    }
    if (form.scope === "CLASS_SECTION" && form.targets.length === 0) {
      setFormError("Select at least one class/section");
      return;
    }
    setSaving(true);
    setFormError("");

    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      scope: form.scope,
      audience: form.audience,
      targets: form.scope === "CLASS_SECTION" ? form.targets : [],
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      publishNow: publishNow && !form.scheduledAt,
    };

    const url = editingId ? `/api/schools/${schoolId}/announcements/${editingId}` : `/api/schools/${schoolId}/announcements`;
    const res = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error ?? "Failed to save announcement");
      setSaving(false);
      return;
    }
    setDialogOpen(false);
    setSaving(false);
    fetchData();
  }

  async function runAction(id: string, action: "publish" | "cancel" | "archive") {
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      return;
    }
    fetchData();
  }

  async function openStats(a: Announcement) {
    setStatsFor({ id: a.id, title: a.title });
    setStats(null);
    const res = await fetch(`/api/schools/${schoolId}/announcements/${a.id}?stats=1`);
    const data = await res.json();
    if (res.ok) setStats(data.stats);
  }

  const summaryCards: { key: string; label: string }[] = [
    { key: "DRAFT", label: "Drafts" },
    { key: "SCHEDULED", label: "Scheduled" },
    { key: "PUBLISHED", label: "Published" },
    { key: "ARCHIVED", label: "Archived" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Announcements</h2>
          <p className="text-sm text-gray-500 mt-1">Post targeted notices and circulars for your school</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map((c) => (
          <Card key={c.key}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{summary[c.key] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search announcements..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder="Scope" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All scopes</SelectItem>
            <SelectItem value="SCHOOL_WIDE">School-wide</SelectItem>
            <SelectItem value="CLASS_SECTION">Class/Section</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-20 text-center"><Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">No announcements found</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"><Megaphone className="w-4 h-4 text-blue-600" /></div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{a.title}</p>
                        <Badge variant={STATUS_BADGE[a.status]}>{a.status}</Badge>
                        <Badge variant="outline">{a.scope === "SCHOOL_WIDE" ? "School-wide" : "Targeted"}</Badge>
                        {a.audience.map((g) => <Badge key={g.group} variant="secondary">{g.group}</Badge>)}
                        {a.correctionCount ? <Badge variant="warning">Corrected x{a.correctionCount}</Badge> : null}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>
                      {a.targets.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          {a.targets.map((t) => `${t.class.name}-${t.section.name}`).join(", ")}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                        {a.publishedAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(a.publishedAt), "dd MMM yyyy, h:mm a")}</span>}
                        {a.scheduledAt && a.status === "SCHEDULED" && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Scheduled {format(new Date(a.scheduledAt), "dd MMM yyyy, h:mm a")}</span>}
                        <span>by {a.createdBy.name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(a.status === "DRAFT" || a.status === "SCHEDULED") && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" title="Edit" onClick={() => openEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-green-600" title="Publish now" onClick={() => setConfirmAction({ id: a.id, action: "publish" })}><Send className="w-3.5 h-3.5" /></Button>
                      </>
                    )}
                    {a.status === "PUBLISHED" && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" title="Correction" onClick={() => openEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-indigo-600" title="Delivery stats" onClick={() => openStats(a)}><BarChart3 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Cancel" onClick={() => setConfirmAction({ id: a.id, action: "cancel" })}><Ban className="w-3.5 h-3.5" /></Button>
                      </>
                    )}
                    {a.status !== "ARCHIVED" && a.status !== "DRAFT" && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-700" title="Archive" onClick={() => setConfirmAction({ id: a.id, action: "archive" })}><Archive className="w-3.5 h-3.5" /></Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Announcement" : "New Announcement"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{formError}</p>}
            <div className="space-y-1.5"><Label>Title *</Label><Input placeholder="e.g. School closed on Friday" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Message *</Label>
              <textarea className="w-full min-h-[100px] px-3 py-2 rounded-md border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Write your announcement here..." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>

            {editingStatus === "PUBLISHED" && (
              <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded">
                This announcement is already published. Saving will apply an audited correction to the title/message/expiry only — scope, audience and targets cannot be changed after publishing.
              </p>
            )}

            {editingStatus !== "PUBLISHED" && (
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as Scope, targets: v === "SCHOOL_WIDE" ? [] : form.targets })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHOOL_WIDE">School-wide</SelectItem>
                  <SelectItem value="CLASS_SECTION">Specific classes/sections</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            {editingStatus !== "PUBLISHED" && form.scope === "CLASS_SECTION" && (
              <div className="space-y-1.5">
                <Label>Classes / Sections *</Label>
                <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                  {classes.map((c) => (
                    <div key={c.id}>
                      <p className="text-xs font-medium text-gray-500">{c.name}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {c.sections.map((s) => {
                          const checked = form.targets.some((t) => t.sectionId === s.id);
                          return (
                            <label key={s.id} className="flex items-center gap-1.5 text-sm px-2 py-1 border rounded-md cursor-pointer">
                              <Checkbox checked={checked} onCheckedChange={() => toggleSection(c.id, s.id)} />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editingStatus !== "PUBLISHED" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Audience *</Label>
                <Button type="button" variant="outline" size="sm" onClick={applyTeachersParentsPreset}>Teachers + Parents preset</Button>
              </div>
              <div className="flex gap-3 flex-wrap">
                {(["STUDENTS", "GUARDIANS", "TEACHERS"] as AudienceGroup[]).map((g) => (
                  <label key={g} className="flex items-center gap-1.5 text-sm px-2 py-1 border rounded-md cursor-pointer">
                    <Checkbox checked={form.audience.includes(g)} onCheckedChange={() => toggleAudience(g)} />
                    {g === "STUDENTS" ? "Students" : g === "GUARDIANS" ? "Parents/Guardians" : "Teachers"}
                  </label>
                ))}
              </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {editingStatus !== "PUBLISHED" && (
                <div className="space-y-1.5">
                  <Label>Schedule for (optional)</Label>
                  <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Expires at (optional)</Label>
                <Input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            {editingStatus === "PUBLISHED" ? (
              <Button onClick={() => save(false)} disabled={saving}>{saving ? "Saving..." : "Save correction"}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => save(false)} disabled={saving}>{saving ? "Saving..." : "Save draft"}</Button>
                <Button onClick={() => save(true)} disabled={saving}>{saving ? "Saving..." : form.scheduledAt ? "Schedule" : "Publish now"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={correctionConfirmOpen}
        onOpenChange={setCorrectionConfirmOpen}
        title="Confirm Correction"
        description="This announcement is already published and visible to its audience. Saving will apply a corrected title/message immediately and is recorded in the audit log as a correction."
        confirmText="Apply correction"
        cancelText="Back"
        onConfirm={() => void submitCorrection()}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.action === "publish" ? "Publish Announcement" : confirmAction?.action === "cancel" ? "Cancel Announcement" : "Archive Announcement"}
        description={
          confirmAction?.action === "publish"
            ? "This will publish the announcement immediately to its selected audience."
            : confirmAction?.action === "cancel"
              ? "This will cancel the announcement — it will no longer be visible to recipients. This action is recorded in the audit log."
              : "This will move the announcement to Archived. It will no longer be visible to recipients."
        }
        confirmText={confirmAction?.action === "publish" ? "Publish" : confirmAction?.action === "cancel" ? "Cancel announcement" : "Archive"}
        cancelText="Back"
        isDestructive={confirmAction?.action !== "publish"}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction.id, confirmAction.action);
          setConfirmAction(null);
        }}
      />

      <Dialog open={statsFor !== null} onOpenChange={(open) => { if (!open) setStatsFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delivery stats — {statsFor?.title}</DialogTitle></DialogHeader>
          {!stats ? (
            <p className="text-sm text-gray-500 py-4">Loading...</p>
          ) : (
            <div className="space-y-3 py-2">
              {Object.entries(stats).map(([group, s]) => (
                <div key={group} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{group}</span>
                  <span className="text-gray-500">{s.read} / {s.eligible} read</span>
                </div>
              ))}
              {Object.keys(stats).length === 0 && <p className="text-sm text-gray-500">No audience groups configured.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
