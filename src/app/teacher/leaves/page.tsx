"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface LeaveRequest {
  id: string;
  reason: string;
  fromDate: string;
  toDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedBy: { name: string } | null;
}

const STATUS_CONFIG = {
  PENDING:  { labelKey: "teacherLeaves.statusPending",  color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  APPROVED: { labelKey: "teacherLeaves.statusApproved", color: "bg-green-50  text-green-700  border-green-200"  },
  REJECTED: { labelKey: "teacherLeaves.statusRejected", color: "bg-red-50    text-red-700    border-red-200"    },
};

export default function TeacherLeavesPage() {
  const { t } = useTranslation();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ reason: "", fromDate: "", toDate: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchLeaves = useCallback(() => {
    setLoading(true);
    fetch("/api/teacher/leaves")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setLeaves(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(fetchLeaves, 0);
    return () => window.clearTimeout(id);
  }, [fetchLeaves]);

  async function submit() {
    if (!form.reason.trim() || !form.fromDate || !form.toDate) {
      setError(t("teacherLeaves.allFieldsRequired")); return;
    }
    if (form.toDate < form.fromDate) { setError(t("teacherLeaves.toDateError")); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/teacher/leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || t("teacherLeaves.failedToSubmit")); setSaving(false); return; }
    setShowForm(false);
    setForm({ reason: "", fromDate: "", toDate: "" });
    fetchLeaves();
    setSaving(false);
  }

  const pending = leaves.filter((l) => l.status === "PENDING").length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("teacherLeaves.title")}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {pending > 0 ? t("teacherLeaves.pendingApproval", { count: pending }) : t("teacherLeaves.submitHint")}
            </p>
          </div>
          <Button onClick={() => { setShowForm(true); setError(""); }} className="gap-2">
            <Plus className="w-4 h-4" /> {t("teacherLeaves.requestLeave")}
          </Button>
        </div>

        {/* Request form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-gray-900 text-sm">{t("teacherLeaves.newRequest")}</p>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">{t("teacherLeaves.from")}</label>
                <input
                  type="date"
                  value={form.fromDate}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">{t("teacherLeaves.to")}</label>
                <input
                  type="date"
                  value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">{t("teacherLeaves.reason")}</label>
              <textarea
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder={t("teacherLeaves.reasonPlaceholder")}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("teacherLeaves.cancel")}</Button>
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving ? t("teacherLeaves.submitting") : t("teacherLeaves.submitRequest")}
              </Button>
            </div>
          </div>
        )}

        {/* Leave list */}
        {loading ? (
          <div className="text-center py-20 text-gray-400">{t("common.loading")}</div>
        ) : leaves.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">{t("teacherLeaves.noLeaveYet")}</p>
              <p className="text-sm text-gray-400 mt-1">{t("teacherLeaves.clickToRequest")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {leaves.map((l) => {
              const days = differenceInCalendarDays(new Date(l.toDate), new Date(l.fromDate)) + 1;
              const cfg = STATUS_CONFIG[l.status];
              return (
                <Card key={l.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{l.reason}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                          <span>{format(new Date(l.fromDate), "dd MMM")} → {format(new Date(l.toDate), "dd MMM yyyy")}</span>
                          <span className="font-medium text-gray-500">{t("teacherLeaves.dayCount", { count: days, plural: days > 1 ? "s" : "" })}</span>
                          <span>{t("teacherLeaves.submittedOn", { date: format(new Date(l.createdAt), "dd MMM yyyy") })}</span>
                          {l.reviewedBy && (
                            <span className="text-gray-500">{t("teacherLeaves.reviewedBy", { name: l.reviewedBy.name })}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("text-xs flex-shrink-0", cfg.color)}>
                        {t(cfg.labelKey)}
                      </Badge>
                    </div>
                    {l.status === "APPROVED" && (
                      <p className="text-xs text-green-600 mt-2 bg-green-50 px-3 py-1.5 rounded-lg">
                        {t("teacherLeaves.approvedNote")}
                      </p>
                    )}
                    {l.status === "REJECTED" && (
                      <p className="text-xs text-red-500 mt-2 bg-red-50 px-3 py-1.5 rounded-lg">
                        {t("teacherLeaves.rejectedNote")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
