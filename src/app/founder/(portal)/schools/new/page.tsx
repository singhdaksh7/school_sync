"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Phone, Mail, Globe, MapPin, UserPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = { id: string; name: string; priceMonthly: string; maxStudents: number | null };
type PlanLoadState = "loading" | "loaded" | "error" | "empty";

export default function NewSchoolPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", address: "", phone: "", email: "", website: "",
    adminName: "", adminEmail: "", planId: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ inviteLink: string | null; emailError: string | null } | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planState, setPlanState] = useState<PlanLoadState>("loading");
  // One idempotency key per mount — resent unchanged on every submit/retry of
  // THIS form session, so a duplicated network retry (or a double click that
  // slips past the disabled-button guard) can never create a second school.
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));

  const loadPlans = useCallback(() => {
    setPlanState("loading");
    fetch("/api/founder/plans?activeOnly=true", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Request failed"))))
      .then((json: { plans: Plan[] }) => {
        setPlans(json.plans);
        setPlanState(json.plans.length === 0 ? "empty" : "loaded");
      })
      .catch(() => setPlanState("error"));
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("School name is required"); return; }
    if (!form.adminName.trim() || !form.adminEmail.trim()) { setError("Admin name and email are required"); return; }
    if (!form.planId) { setError("Select a plan"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/founder/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, idempotencyKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create school");
        return;
      }
      setSuccess({ inviteLink: data.inviteLink ?? null, emailError: data.emailError ?? null });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> School created</CardTitle>
            <CardDescription>
              {form.name} was created and an admin invite was sent to {form.adminEmail}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {success.emailError && (
              <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-md border border-amber-200">{success.emailError}</div>
            )}
            {success.inviteLink && (
              <div className="space-y-1.5">
                <Label>Invite link</Label>
                <Input value={success.inviteLink} readOnly className="text-xs font-mono bg-muted" />
              </div>
            )}
            <Button className="w-full" onClick={() => router.push("/founder/schools")}>Done</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/founder/schools"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Schools
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Create School</CardTitle>
          <CardDescription>
            Creates the school, assigns the plan, and sends the first admin an invite to set their password —
            all in one step.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-md border border-red-200">{error}</div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="schoolName">School name *</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="schoolName"
                  className="pl-9"
                  placeholder="Greenwood High School"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="address"
                  className="pl-9"
                  placeholder="123 School Road, City"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input id="phone" className="pl-9" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schoolEmail">School email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input id="schoolEmail" type="email" className="pl-9" placeholder="info@school.edu" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input id="website" className="pl-9" placeholder="https://school.edu" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="adminName">Admin name *</Label>
                <Input id="adminName" placeholder="Jane Doe" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminEmail">Admin email *</Label>
                <Input id="adminEmail" type="email" placeholder="admin@school.edu" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required />
              </div>

              <div className="space-y-1.5">
                <Label>Plan *</Label>
                {planState === "loading" && (
                  <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                )}
                {planState === "error" && (
                  <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <span>Couldn&apos;t load plans.</span>
                    <button type="button" onClick={loadPlans} className="inline-flex items-center gap-1 font-medium hover:underline">
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  </div>
                )}
                {planState === "empty" && (
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    No active plans yet.{" "}
                    <Link href="/founder/billing" className="font-medium text-foreground hover:underline">
                      Create one in Billing
                    </Link>{" "}
                    before adding a school.
                  </div>
                )}
                {planState === "loaded" && (
                  <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
                    <SelectContent>
                      {plans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading || planState !== "loaded"}>
              {loading ? "Creating..." : "Create School"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
