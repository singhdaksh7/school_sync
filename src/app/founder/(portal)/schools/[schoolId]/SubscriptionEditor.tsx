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
import { useTranslation } from "@/lib/i18n/LanguageContext";

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
  const { t } = useTranslation();
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
      setError(t("founder.selectAPlan"));
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
      if (!res.ok) throw new Error(t("founder.requestFailed"));
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("founder.couldntSaveSubscription"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Pencil className="h-3.5 w-3.5" /> {t("founder.editSubscription")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("founder.editSubscription")}</DialogTitle>
            <DialogDescription>{t("founder.editSubscriptionDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("founder.plan")}</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder={t("founder.selectAPlan")} /></SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>{plan.name}{!plan.isActive ? ` (${t("founder.inactive")})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("founder.billingCycle")}</Label>
              <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as "MONTHLY" | "ANNUAL")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">{t("founder.monthly")}</SelectItem>
                  <SelectItem value="ANNUAL">{t("founder.annual")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("founder.amountInRupees")}</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("founder.renewalMonth")}</Label>
              <Input type="month" value={renewalMonth} onChange={(e) => setRenewalMonth(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("founder.renewalDatesNote")}</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
