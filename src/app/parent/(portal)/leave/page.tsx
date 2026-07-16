"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { ClipboardList, Plus, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useParentFetch } from "@/lib/parent-web-auth";

interface Child {
  id: string;
  name: string;
  rollNo: string;
  section: { name: string; class: { name: string } } | null;
}

interface LeaveRequest {
  id: string;
  studentId: string;
  reason: string;
  fromDate: string;
  toDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedBy: { name: string } | null;
  student: Child | null;
}

const LEAVE_TYPES = ["Sick Leave", "Casual Leave", "Family Function", "Medical Appointment", "Other"];
type StatusFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

const STATUS_CONFIG: Record<LeaveRequest["status"], { labelKey: string; variant: "warning" | "success" | "destructive" }> = {
  PENDING: { labelKey: "studentLeave.statusPending", variant: "warning" },
  APPROVED: { labelKey: "studentLeave.statusApproved", variant: "success" },
  REJECTED: { labelKey: "studentLeave.statusRejected", variant: "destructive" },
};

function todayStr() {
  return format(new Date(), "yyyy-MM-dd");
}

function sameDayCutoffPassed() {
  const now = new Date();
  return now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() >= 30);
}

export default function ParentLeavePage() {
  const { t } = useTranslation();
  const parentFetch = useParentFetch();

  const [children, setChildren] = useState<Child[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ studentId: "", leaveType: LEAVE_TYPES[0], reason: "", fromDate: "", toDate: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchLeaves = useCallback(() => {
    setLoading(true);
    setLoadError("");
    parentFetch("/api/parent/leave")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t("parentLeave.loadFailed"));
        setChildren(data.children || []);
        setLeaves(data.leaves || []);
        if (data.children?.length === 1) setForm((f) => ({ ...f, studentId: data.children[0].id }));
      })
      .catch((err) => setLoadError(err.message || t("parentLeave.loadFailed")))
      .finally(() => setLoading(false));
  }, [parentFetch, t]);

  useEffect(() => {
    const id = window.setTimeout(fetchLeaves, 0);
    return () => window.clearTimeout(id);
  }, [fetchLeaves]);

  const filteredLeaves = useMemo(() => {
    return leaves.filter((l) => {
      if (selectedChildId !== "ALL" && l.studentId !== selectedChildId) return false;
      if (statusFilter !== "ALL" && l.status !== statusFilter) return false;
      return true;
    });
  }, [leaves, selectedChildId, statusFilter]);

  const sameDayBlocked = form.fromDate === todayStr() && sameDayCutoffPassed();

  async function submit() {
    if (!form.studentId) { setFormError(t("parentLeave.selectChild")); return; }
    if (!form.reason.trim() || !form.fromDate || !form.toDate) { setFormError(t("studentLeave.allFieldsRequired")); return; }
    if (form.toDate < form.fromDate) { setFormError(t("studentLeave.toDateError")); return; }
    if (sameDayBlocked) { setFormError(t("studentLeave.sameDayBlocked")); return; }

    setSaving(true);
    setFormError("");
    const res = await parentFetch("/api/parent/leave", {
      method: "POST",
      body: JSON.stringify({
        studentId: form.studentId,
        leaveType: form.leaveType,
        reason: form.reason,
        fromDate: form.fromDate,
        toDate: form.toDate,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setFormError(data.error || t("studentLeave.failedToSubmit")); setSaving(false); return; }
    setShowForm(false);
    setForm((f) => ({ ...f, reason: "", fromDate: "", toDate: "" }));
    fetchLeaves();
    setSaving(false);
  }

  const pending = filteredLeaves.filter((l) => l.status === "PENDING").length;
  const childLabel = (child: Child | null) => (child ? `${child.name} (${child.section?.class.name ?? ""} ${child.section?.name ?? ""})`.trim() : "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("parentLeave.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending > 0 ? t("studentLeave.pendingApproval", { count: pending, plural: pending > 1 ? "s" : "" }) : t("parentLeave.subtitle")}
          </p>
        </div>
        <Button onClick={() => { setShowForm(true); setFormError(""); }} className="gap-2" disabled={children.length === 0}>
          <Plus className="h-4 w-4" /> {t("parentLeave.newRequest")}
        </Button>
      </div>

      {children.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">{t("parentLeave.childSelector")}</label>
          <Select value={selectedChildId} onValueChange={setSelectedChildId}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("parentLeave.allChildren")}</SelectItem>
              {children.map((c) => (
                <SelectItem key={c.id} value={c.id}>{childLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="ALL">{t("parentLeave.filterAll")}</TabsTrigger>
          <TabsTrigger value="PENDING">{t("studentLeave.statusPending")}</TabsTrigger>
          <TabsTrigger value="APPROVED">{t("studentLeave.statusApproved")}</TabsTrigger>
          <TabsTrigger value="REJECTED">{t("studentLeave.statusRejected")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {showForm && (
        <Card className="border-border">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{t("parentLeave.newRequest")}</p>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {formError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

            {children.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{t("parentLeave.childSelector")}</label>
                <Select value={form.studentId} onValueChange={(v) => setForm({ ...form, studentId: v })}>
                  <SelectTrigger><SelectValue placeholder={t("parentLeave.selectChild")} /></SelectTrigger>
                  <SelectContent>
                    {children.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{childLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">{t("studentLeave.leaveType")}</label>
              <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((lt) => <SelectItem key={lt} value={lt}>{lt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{t("studentLeave.from")}</label>
                <input
                  type="date"
                  min={todayStr()}
                  value={form.fromDate}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{t("studentLeave.to")}</label>
                <input
                  type="date"
                  min={form.fromDate || todayStr()}
                  value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {t("parentLeave.cutoffExplanation")}
            </p>
            {sameDayBlocked && (
              <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300">
                {t("studentLeave.sameDayBlocked")}
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">{t("studentLeave.reason")}</label>
              <Textarea
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder={t("studentLeave.reasonPlaceholder")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("studentLeave.cancel")}</Button>
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving ? t("studentLeave.submitting") : t("studentLeave.submitRequest")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-destructive/70" />
            <p className="mt-3 font-medium text-foreground">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchLeaves}>{t("common.retry")}</Button>
          </CardContent>
        </Card>
      ) : filteredLeaves.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-foreground">{t("studentLeave.noLeaveYet")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("parentLeave.clickToRequest")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLeaves.map((l) => {
            const days = differenceInCalendarDays(new Date(l.toDate), new Date(l.fromDate)) + 1;
            const cfg = STATUS_CONFIG[l.status];
            return (
              <Card key={l.id} className={cn("border-border transition-shadow hover:shadow-sm")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {l.student && children.length > 1 && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{l.student.name}</p>
                      )}
                      <p className="text-sm font-medium text-foreground">{l.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{format(new Date(l.fromDate), "dd MMM")} → {format(new Date(l.toDate), "dd MMM yyyy")}</span>
                        <span className="font-medium">{t("studentLeave.dayCount", { count: days, plural: days > 1 ? "s" : "" })}</span>
                        <span>{t("studentLeave.submittedOn", { date: format(new Date(l.createdAt), "dd MMM yyyy") })}</span>
                        {l.reviewedBy && <span>{t("studentLeave.reviewedBy", { name: l.reviewedBy.name })}</span>}
                      </div>
                    </div>
                    <Badge variant={cfg.variant} className="flex-shrink-0">{t(cfg.labelKey)}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
