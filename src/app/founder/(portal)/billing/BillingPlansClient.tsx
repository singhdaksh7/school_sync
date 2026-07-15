"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  priceMonthly: string;
  priceAnnual: string;
  maxStudents: number | null;
  staffLimit: number | null;
  enabledFeatures: FeatureFlagKeyValue[];
  isActive: boolean;
  _count: { subscriptions: number };
};

type FormState = {
  name: string;
  description: string;
  currency: string;
  priceMonthly: string;
  priceAnnual: string;
  maxStudents: string;
  staffLimit: string;
  enabledFeatures: FeatureFlagKeyValue[];
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  currency: "INR",
  priceMonthly: "",
  priceAnnual: "",
  maxStudents: "",
  staffLimit: "",
  enabledFeatures: [...FEATURE_FLAG_KEYS],
  isActive: true,
};

export default function BillingPlansClient() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(false);
    fetch("/api/founder/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Request failed"))))
      .then((json: { plans: Plan[] }) => setPlans(json.plans))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditingPlan(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      description: plan.description ?? "",
      currency: plan.currency,
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      maxStudents: plan.maxStudents?.toString() ?? "",
      staffLimit: plan.staffLimit?.toString() ?? "",
      enabledFeatures: plan.enabledFeatures,
      isActive: plan.isActive,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function toggleFeature(key: FeatureFlagKeyValue) {
    setForm((f) => ({
      ...f,
      enabledFeatures: f.enabledFeatures.includes(key)
        ? f.enabledFeatures.filter((k) => k !== key)
        : [...f.enabledFeatures, key],
    }));
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError(t("founder.nameIsRequired"));
      return;
    }
    setSaving(true);
    setFormError(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      currency: form.currency.trim().toUpperCase() || "INR",
      priceMonthly: Number(form.priceMonthly) || 0,
      priceAnnual: Number(form.priceAnnual) || 0,
      maxStudents: form.maxStudents.trim() ? Number(form.maxStudents) : null,
      staffLimit: form.staffLimit.trim() ? Number(form.staffLimit) : null,
      enabledFeatures: form.enabledFeatures,
      ...(editingPlan ? { isActive: form.isActive } : {}),
    };

    try {
      const res = await fetch(editingPlan ? `/api/founder/plans/${editingPlan.id}` : "/api/founder/plans", {
        method: editingPlan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t("founder.requestFailed"));
      setDialogOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("auth.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(plan: Plan) {
    if (plan._count.subscriptions > 0) return; // button is disabled in this case; defense in depth
    if (!window.confirm(`Delete the "${plan.name}" plan? This cannot be undone.`)) return;
    setDeletingId(plan.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/founder/plans/${plan.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t("founder.requestFailed"));
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("auth.somethingWentWrong"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("founder.billingPlans")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("founder.billingPlansDescription")}</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("founder.createPlan")}
        </Button>
      </div>

      {deleteError && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-md border border-destructive/30">{deleteError}</div>
      )}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("founder.plans")}{plans ? ` (${plans.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 py-14 text-center">
              <p className="text-sm font-medium text-foreground">{t("founder.couldntLoadPlans")}</p>
            </div>
          ) : !plans || plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <CreditCard className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("founder.noPlansYet")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t("founder.plan")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.monthly")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.annual")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.maxStudents")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("nav.schools")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("founder.status")}</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-4 font-medium text-foreground">{plan.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(plan.priceMonthly)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(plan.priceAnnual)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{plan.maxStudents ?? t("founder.unlimited")}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{plan._count.subscriptions}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={plan.isActive ? "success" : "secondary"}>{plan.isActive ? t("founder.active") : t("founder.inactive")}</Badge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => openEdit(plan)} className="gap-1.5">
                            <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deletePlan(plan)}
                            disabled={plan._count.subscriptions > 0 || deletingId === plan.id}
                            title={plan._count.subscriptions > 0 ? "Assigned to a school — deactivate instead of deleting" : undefined}
                            className="gap-1.5 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlan ? t("founder.editPlan") : t("founder.createPlan")}</DialogTitle>
            <DialogDescription>{t("founder.setPricingDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("founder.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Basic" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("founder.monthlyPrice")}</Label>
                <Input type="number" min="0" step="0.01" value={form.priceMonthly} onChange={(e) => setForm((f) => ({ ...f, priceMonthly: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("founder.annualPrice")}</Label>
                <Input type="number" min="0" step="0.01" value={form.priceAnnual} onChange={(e) => setForm((f) => ({ ...f, priceAnnual: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional, shown to Founders only" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("founder.maxStudentsOptional")}</Label>
                <Input type="number" min="0" value={form.maxStudents} onChange={(e) => setForm((f) => ({ ...f, maxStudents: e.target.value }))} placeholder={t("founder.leaveBlankUnlimited")} />
              </div>
              <div className="space-y-1.5">
                <Label>Staff limit (optional)</Label>
                <Input type="number" min="0" value={form.staffLimit} onChange={(e) => setForm((f) => ({ ...f, staffLimit: e.target.value }))} placeholder="Leave blank = unlimited" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Enabled modules</Label>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-border p-3">
                {FEATURE_FLAG_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={form.enabledFeatures.includes(key)} onChange={() => toggleFeature(key)} />
                    {FEATURE_FLAG_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
            {editingPlan && (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <Label className="!mb-0">{t("founder.activeAssignable")}</Label>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4"
                />
              </div>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
