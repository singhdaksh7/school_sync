"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Search, Calendar, Clock, Archive, Ban, Send, Pencil, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useTeacherPermissions } from "@/hooks/useTeacherPermissions";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Status = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED" | "CANCELLED";
type AudienceGroup = "GUARDIANS" | "STUDENTS";

interface AuthorizedSection {
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  status: Status;
  publishedAt: string | null;
  scheduledAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  audience: { group: AudienceGroup }[];
  targets: { classId: string; sectionId: string; class: { name: string }; section: { name: string } }[];
  correctionCount?: number;
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
  audience: [] as AudienceGroup[],
  targets: [] as { classId: string; sectionId: string }[],
  scheduledAt: "",
  expiresAt: "",
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TeacherAnnouncementsPage() {
  const { t } = useTranslation();
  const { has: hasPermission, loading: permissionsLoading } = useTeacherPermissions();
  const canView = hasPermission("ANNOUNCEMENTS", "VIEW");
  const canCreate = hasPermission("ANNOUNCEMENTS", "CREATE");
  const canEdit = hasPermission("ANNOUNCEMENTS", "EDIT");

  const [sections, setSections] = useState<AuthorizedSection[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

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

  const fetchData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mine: "1", limit: "100" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/teacher/announcements?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("teacherAnnouncements.couldNotLoad"));
      setAnnouncements(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("teacherAnnouncements.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [canView, statusFilter, search, t]);

  useEffect(() => {
    const id = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(id);
  }, [fetchData]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    fetch("/api/teacher/announcements?authorizedSections=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.sections) setSections(data.sections);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canCreate]);

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
      audience: a.audience.map((x) => x.group) as AudienceGroup[],
      targets: a.targets.map((tg) => ({ classId: tg.classId, sectionId: tg.sectionId })),
      scheduledAt: a.scheduledAt ? a.scheduledAt.slice(0, 16) : "",
      expiresAt: a.expiresAt ? a.expiresAt.slice(0, 16) : "",
    });
    setFormError("");
    setDialogOpen(true);
  }

  function toggleAudience(group: AudienceGroup) {
    setForm((f) => ({ ...f, audience: f.audience.includes(group) ? f.audience.filter((g) => g !== group) : [...f.audience, group] }));
  }

  function toggleSection(classId: string, sectionId: string) {
    setForm((f) => {
      const exists = f.targets.some((tg) => tg.sectionId === sectionId);
      return { ...f, targets: exists ? f.targets.filter((tg) => tg.sectionId !== sectionId) : [...f.targets, { classId, sectionId }] };
    });
  }

  async function submitCorrection() {
    if (!editingId) return;
    setSaving(true);
    setFormError("");
    const res = await fetch(`/api/teacher/announcements/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "correct",
        title: form.title.trim(),
        body: form.body.trim(),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error ?? t("teacherAnnouncements.couldNotSaveCorrection"));
      setSaving(false);
      return;
    }
    setDialogOpen(false);
    setCorrectionConfirmOpen(false);
    setSaving(false);
    await fetchData();
  }

  async function save(publishNow: boolean) {
    if (!form.title.trim() || !form.body.trim()) {
      setFormError(t("teacherAnnouncements.titleAndMessageRequired"));
      return;
    }

    // A published announcement is edited via the audited correction workflow
    // (title/body/expiry only) — scope/audience/targets are locked once live.
    if (editingStatus === "PUBLISHED") {
      setCorrectionConfirmOpen(true);
      return;
    }

    if (form.audience.length === 0) {
      setFormError(t("teacherAnnouncements.selectAudience"));
      return;
    }
    if (form.targets.length === 0) {
      setFormError(t("teacherAnnouncements.selectClassSection"));
      return;
    }
    setSaving(true);
    setFormError("");

    // Always CLASS_SECTION for a teacher, never SCHOOL_WIDE, and never a
    // TEACHERS audience group — the create form never even renders those
    // options. schoolId/createdById are never part of this payload; the
    // server derives both from the authenticated session.
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      scope: "CLASS_SECTION" as const,
      audience: form.audience,
      targets: form.targets,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      publishNow: publishNow && !form.scheduledAt,
    };

    const url = editingId ? `/api/teacher/announcements/${editingId}` : "/api/teacher/announcements";
    const res = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error ?? t("teacherAnnouncements.couldNotSave"));
      setSaving(false);
      return;
    }
    setDialogOpen(false);
    setSaving(false);
    await fetchData();
  }

  async function runAction(id: string, action: "publish" | "cancel" | "archive") {
    setError("");
    const res = await fetch(`/api/teacher/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? t("teacherAnnouncements.actionFailed"));
      return;
    }
    await fetchData();
  }

  async function openStats(a: Announcement) {
    setStatsFor({ id: a.id, title: a.title });
    setStats(null);
    const res = await fetch(`/api/teacher/announcements/${a.id}?stats=1`);
    const data = await res.json();
    if (res.ok) setStats(data.stats);
  }

  const filtered = useMemo(() => announcements, [announcements]);

  if (permissionsLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-16 text-center">
            <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">{t("teacherAnnouncements.noPermissionToView")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("teacherAnnouncements.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("teacherAnnouncements.subtitle")}</p>
        </div>
        {canCreate && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> {t("teacherAnnouncements.newAnnouncement")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("teacherAnnouncements.searchLabel")}
            placeholder={t("teacherAnnouncements.searchLabel")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("teacherAnnouncements.filterStatusLabel")} className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("teacherAnnouncements.filterAllStatuses")}</SelectItem>
            <SelectItem value="DRAFT">{t("teacherAnnouncements.statusDraft")}</SelectItem>
            <SelectItem value="SCHEDULED">{t("teacherAnnouncements.statusScheduled")}</SelectItem>
            <SelectItem value="PUBLISHED">{t("teacherAnnouncements.statusPublished")}</SelectItem>
            <SelectItem value="ARCHIVED">{t("teacherAnnouncements.statusArchived")}</SelectItem>
            <SelectItem value="CANCELLED">{t("teacherAnnouncements.statusCancelled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded" role="alert">{error}</p>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">{t("teacherAnnouncements.noAnnouncementsFound")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Megaphone className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{a.title}</p>
                        <Badge variant={STATUS_BADGE[a.status]}>{t(`teacherAnnouncements.status${a.status.charAt(0)}${a.status.slice(1).toLowerCase()}`)}</Badge>
                        {a.audience.map((g) => (
                          <Badge key={g.group} variant="secondary">
                            {g.group === "STUDENTS" ? t("teacherAnnouncements.audienceStudents") : t("teacherAnnouncements.audienceGuardians")}
                          </Badge>
                        ))}
                        {a.correctionCount ? <Badge variant="warning">{t("teacherAnnouncements.correctedBadge", { count: a.correctionCount })}</Badge> : null}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>
                      {a.targets.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">{a.targets.map((tg) => `${tg.class.name}-${tg.section.name}`).join(", ")}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                        {a.publishedAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {formatDateTime(a.publishedAt)}
                          </span>
                        )}
                        {a.scheduledAt && a.status === "SCHEDULED" && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {t("teacherAnnouncements.scheduledFor", { date: formatDateTime(a.scheduledAt) })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {(a.status === "DRAFT" || a.status === "SCHEDULED") && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" title={t("teacherAnnouncements.edit")} onClick={() => openEdit(a)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-400 hover:text-green-600"
                            title={t("teacherAnnouncements.publishNow")}
                            onClick={() => setConfirmAction({ id: a.id, action: "publish" })}
                          >
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {a.status === "PUBLISHED" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" title={t("teacherAnnouncements.correction")} onClick={() => openEdit(a)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-indigo-600" title={t("teacherAnnouncements.deliveryStats")} onClick={() => openStats(a)}>
                            <BarChart3 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-400 hover:text-red-600"
                            title={t("teacherAnnouncements.cancel")}
                            onClick={() => setConfirmAction({ id: a.id, action: "cancel" })}
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {a.status !== "ARCHIVED" && a.status !== "DRAFT" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-gray-700"
                          title={t("teacherAnnouncements.archive")}
                          onClick={() => setConfirmAction({ id: a.id, action: "archive" })}
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("teacherAnnouncements.editAnnouncement") : t("teacherAnnouncements.newAnnouncement")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded" role="alert">{formError}</p>}
            <div className="space-y-1.5">
              <Label>{t("teacherAnnouncements.titleLabel")}</Label>
              <Input
                aria-label={t("teacherAnnouncements.titleLabel")}
                placeholder={t("teacherAnnouncements.titlePlaceholder")}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("teacherAnnouncements.messageLabel")}</Label>
              <textarea
                aria-label={t("teacherAnnouncements.messageLabel")}
                className="w-full min-h-[100px] px-3 py-2 rounded-md border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("teacherAnnouncements.messagePlaceholder")}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>

            {editingStatus === "PUBLISHED" && (
              <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded">{t("teacherAnnouncements.correctionNotice")}</p>
            )}

            {editingStatus !== "PUBLISHED" && (
              <div className="space-y-1.5">
                <Label>{t("teacherAnnouncements.classesSections")}</Label>
                {sections.length === 0 ? (
                  <p className="text-xs text-gray-400">{t("teacherAnnouncements.noAuthorizedSections")}</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border rounded-md p-2 flex flex-wrap gap-2">
                    {sections.map((s) => {
                      const checked = form.targets.some((tg) => tg.sectionId === s.sectionId);
                      return (
                        <label key={s.sectionId} className="flex items-center gap-1.5 text-sm px-2 py-1 border rounded-md cursor-pointer">
                          <Checkbox checked={checked} onCheckedChange={() => toggleSection(s.classId, s.sectionId)} />
                          {s.className}-{s.sectionName}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {editingStatus !== "PUBLISHED" && (
              <div className="space-y-1.5">
                <Label>{t("teacherAnnouncements.audience")}</Label>
                <div className="flex gap-3 flex-wrap">
                  {(["STUDENTS", "GUARDIANS"] as AudienceGroup[]).map((g) => (
                    <label key={g} className="flex items-center gap-1.5 text-sm px-2 py-1 border rounded-md cursor-pointer">
                      <Checkbox checked={form.audience.includes(g)} onCheckedChange={() => toggleAudience(g)} />
                      {g === "STUDENTS" ? t("teacherAnnouncements.audienceStudents") : t("teacherAnnouncements.audienceGuardians")}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {editingStatus !== "PUBLISHED" && (
                <div className="space-y-1.5">
                  <Label>{t("teacherAnnouncements.scheduleFor")}</Label>
                  <Input
                    aria-label={t("teacherAnnouncements.scheduleFor")}
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t("teacherAnnouncements.expiresAt")}</Label>
                <Input
                  aria-label={t("teacherAnnouncements.expiresAt")}
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("teacherAnnouncements.dialogCancel")}</Button>
            {editingStatus === "PUBLISHED" ? (
              <Button onClick={() => save(false)} disabled={saving}>{saving ? t("teacherAnnouncements.saving") : t("teacherAnnouncements.saveCorrection")}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => save(false)} disabled={saving}>{saving ? t("teacherAnnouncements.saving") : t("teacherAnnouncements.saveDraft")}</Button>
                <Button onClick={() => save(true)} disabled={saving}>
                  {saving ? t("teacherAnnouncements.saving") : form.scheduledAt ? t("teacherAnnouncements.schedule") : t("teacherAnnouncements.publishNow")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={correctionConfirmOpen}
        onOpenChange={setCorrectionConfirmOpen}
        title={t("teacherAnnouncements.confirmCorrectionTitle")}
        description={t("teacherAnnouncements.confirmCorrectionDescription")}
        confirmText={t("teacherAnnouncements.applyCorrection")}
        cancelText={t("teacherAnnouncements.dialogBack")}
        onConfirm={() => void submitCorrection()}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.action === "publish"
            ? t("teacherAnnouncements.confirmPublishTitle")
            : confirmAction?.action === "cancel"
              ? t("teacherAnnouncements.confirmCancelTitle")
              : t("teacherAnnouncements.confirmArchiveTitle")
        }
        description={
          confirmAction?.action === "publish"
            ? t("teacherAnnouncements.confirmPublishDescription")
            : confirmAction?.action === "cancel"
              ? t("teacherAnnouncements.confirmCancelDescription")
              : t("teacherAnnouncements.confirmArchiveDescription")
        }
        confirmText={
          confirmAction?.action === "publish"
            ? t("teacherAnnouncements.publishNow")
            : confirmAction?.action === "cancel"
              ? t("teacherAnnouncements.cancel")
              : t("teacherAnnouncements.archive")
        }
        cancelText={t("teacherAnnouncements.dialogBack")}
        isDestructive={confirmAction?.action !== "publish"}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction.id, confirmAction.action);
          setConfirmAction(null);
        }}
      />

      <Dialog open={statsFor !== null} onOpenChange={(open) => { if (!open) setStatsFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("teacherAnnouncements.deliveryStatsFor", { title: statsFor?.title ?? "" })}</DialogTitle>
          </DialogHeader>
          {!stats ? (
            <p className="text-sm text-gray-500 py-4">{t("teacherAnnouncements.loadingStats")}</p>
          ) : (
            <div className="space-y-3 py-2">
              {Object.entries(stats).map(([group, s]) => (
                <div key={group} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{group}</span>
                  <span className="text-gray-500">{t("teacherAnnouncements.readOfEligible", { read: s.read, eligible: s.eligible })}</span>
                </div>
              ))}
              {Object.keys(stats).length === 0 && <p className="text-sm text-gray-500">{t("teacherAnnouncements.noAudienceGroups")}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
