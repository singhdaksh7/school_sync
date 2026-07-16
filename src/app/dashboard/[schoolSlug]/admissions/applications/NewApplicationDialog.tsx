"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Cycle = { id: string; name: string; sessionLabel: string; status: string };
type Offering = { id: string; admissionCycleId: string; className: string };

const emptyForm = {
  admissionCycleId: "",
  admissionOfferingId: "",
  applicantFirstName: "",
  applicantMiddleName: "",
  applicantLastName: "",
  applicantDob: "",
  applicantGender: "",
  currentSchoolName: "",
  previousSchoolName: "",
  guardianName: "",
  guardianRelation: "",
  guardianPhone: "",
  guardianEmail: "",
  addressLine1: "",
  addressLine2: "",
  addressCity: "",
  addressState: "",
  addressPostalCode: "",
  source: "",
};

export default function NewApplicationDialog({
  schoolId,
  cycles,
  offerings,
  onClose,
  onCreated,
}: {
  schoolId: string;
  cycles: Cycle[];
  offerings: Offering[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const availableOfferings = offerings.filter((o) => o.admissionCycleId === form.admissionCycleId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/schools/${schoolId}/admissions/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create application" }));
        throw new Error(body.error ?? "Failed to create application");
      }
      onCreated();
    } catch (err) {
      // Preserve entered data on validation error — the dialog stays open
      // and `form` state is untouched, so the applicant/guardian/address
      // fields the staff member already typed are not lost.
      setError(err instanceof Error ? err.message : "Failed to create application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New admission application</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Cycle & offering</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cycle</Label>
                <select
                  required
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.admissionCycleId}
                  onChange={(e) => setForm((f) => ({ ...f, admissionCycleId: e.target.value, admissionOfferingId: "" }))}
                >
                  <option value="">Select cycle</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.sessionLabel})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Requested class</Label>
                <select
                  required
                  disabled={!form.admissionCycleId}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.admissionOfferingId}
                  onChange={set("admissionOfferingId")}
                >
                  <option value="">Select class</option>
                  {availableOfferings.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.className}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Applicant</h3>
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="First name" required value={form.applicantFirstName} onChange={set("applicantFirstName")} />
              <Input placeholder="Middle name" value={form.applicantMiddleName} onChange={set("applicantMiddleName")} />
              <Input placeholder="Last name" required value={form.applicantLastName} onChange={set("applicantLastName")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date of birth</Label>
                <Input type="date" required value={form.applicantDob} onChange={set("applicantDob")} />
              </div>
              <Input placeholder="Gender (optional)" value={form.applicantGender} onChange={set("applicantGender")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Current school (optional)" value={form.currentSchoolName} onChange={set("currentSchoolName")} />
              <Input placeholder="Previous school (optional)" value={form.previousSchoolName} onChange={set("previousSchoolName")} />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Guardian</h3>
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="Guardian name" required value={form.guardianName} onChange={set("guardianName")} />
              <Input placeholder="Relation" required value={form.guardianRelation} onChange={set("guardianRelation")} />
              <Input placeholder="Phone" required value={form.guardianPhone} onChange={set("guardianPhone")} />
            </div>
            <Input placeholder="Email (optional)" value={form.guardianEmail} onChange={set("guardianEmail")} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Address (optional)</h3>
            <Input placeholder="Address line 1" value={form.addressLine1} onChange={set("addressLine1")} />
            <Input placeholder="Address line 2" value={form.addressLine2} onChange={set("addressLine2")} />
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="City" value={form.addressCity} onChange={set("addressCity")} />
              <Input placeholder="State" value={form.addressState} onChange={set("addressState")} />
              <Input placeholder="Postal code" value={form.addressPostalCode} onChange={set("addressPostalCode")} />
            </div>
          </section>

          <Input placeholder="Source / referral (optional)" value={form.source} onChange={set("source")} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
