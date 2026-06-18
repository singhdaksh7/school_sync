"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = { id: string; name: string; priceMonthly: string; priceAnnual: string; isActive: boolean };

type CurrentSubscription = {
  planId: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  amount: string;
  currentPeriodEnd: string | null;
};

export default function SubscriptionEditor({
  schoolId,
  current,
}: {
  schoolId: string;
  current: CurrentSubscription | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState(current?.planId ?? "");
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">(current?.billingCycle ?? "MONTHLY");
  const [amount, setAmount] = useState(current?.amount ?? "");
  const [renewalMonth, setRenewalMonth] = useState(current?.currentPeriodEnd?.slice(0, 7) ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/founder/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { plans: Plan[] } | null) => {
        if (json) setPlans(json.plans);
      });
  }, [open]);

  async function save() {
    if (!planId) {
      setError("Select a plan");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/founder/schools/${schoolId}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          billingCycle,
          amount: Number(amount),
          currentPeriodEnd: renewalMonth ? `${renewalMonth}-01` : null,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't save subscription. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Pencil className="h-3.5 w-3.5" /> Edit Subscription
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subscription</DialogTitle>
            <DialogDescription>Assign a plan and manually set the billing details for this school.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>{plan.name}{!plan.isActive ? " (inactive)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Billing Cycle</Label>
              <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as "MONTHLY" | "ANNUAL")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="ANNUAL">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Renewal Month</Label>
              <Input type="month" value={renewalMonth} onChange={(e) => setRenewalMonth(e.target.value)} />
              <p className="text-xs text-muted-foreground">Renewal dates are always the 1st of the selected month.</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
