"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

type Plan = {
  id: string;
  name: string;
  priceMonthly: string;
  priceAnnual: string;
  maxStudents: number | null;
  isActive: boolean;
  _count: { subscriptions: number };
};

type FormState = { name: string; priceMonthly: string; priceAnnual: string; maxStudents: string; isActive: boolean };

const EMPTY_FORM: FormState = { name: "", priceMonthly: "", priceAnnual: "", maxStudents: "", isActive: true };

export default function BillingPlansClient() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      maxStudents: plan.maxStudents?.toString() ?? "",
      isActive: plan.isActive,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    setSaving(true);
    setFormError(null);

    const payload = {
      name: form.name.trim(),
      priceMonthly: Number(form.priceMonthly) || 0,
      priceAnnual: Number(form.priceAnnual) || 0,
      maxStudents: form.maxStudents.trim() ? Number(form.maxStudents) : null,
      ...(editingPlan ? { isActive: form.isActive } : {}),
    };

    try {
      const res = await fetch(editingPlan ? `/api/founder/plans/${editingPlan.id}` : "/api/founder/plans", {
        method: editingPlan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setDialogOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Billing Plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage the subscription plan catalog. No payment gateway involved — assignment is manual.</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Plan
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Plans{plans ? ` (${plans.length})` : ""}</CardTitle>
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
              <p className="text-sm font-medium text-foreground">Couldn&apos;t load plans</p>
            </div>
          ) : !plans || plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <CreditCard className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No plans yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Plan</th>
                    <th className="pb-2 pr-4 font-medium">Monthly</th>
                    <th className="pb-2 pr-4 font-medium">Annual</th>
                    <th className="pb-2 pr-4 font-medium">Max Students</th>
                    <th className="pb-2 pr-4 font-medium">Schools</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-4 font-medium text-foreground">{plan.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(plan.priceMonthly)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(plan.priceAnnual)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{plan.maxStudents ?? "Unlimited"}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{plan._count.subscriptions}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={plan.isActive ? "success" : "secondary"}>{plan.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="py-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => openEdit(plan)} className="gap-1.5">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
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
            <DialogTitle>{editingPlan ? "Edit Plan" : "Create Plan"}</DialogTitle>
            <DialogDescription>Set pricing for this plan. Existing assignments keep their original amount until reassigned.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Basic" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monthly Price (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.priceMonthly} onChange={(e) => setForm((f) => ({ ...f, priceMonthly: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Annual Price (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.priceAnnual} onChange={(e) => setForm((f) => ({ ...f, priceAnnual: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Max Students (optional)</Label>
              <Input type="number" min="0" value={form.maxStudents} onChange={(e) => setForm((f) => ({ ...f, maxStudents: e.target.value }))} placeholder="Leave blank for unlimited" />
            </div>
            {editingPlan && (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <Label className="!mb-0">Active (assignable to schools)</Label>
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
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
