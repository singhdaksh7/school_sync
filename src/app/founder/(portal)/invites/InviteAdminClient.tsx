"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = { id: string; name: string; isActive: boolean };
type SchoolOption = { id: string; name: string; slug: string };

export default function InviteAdminClient({
  defaultSchoolId,
  defaultSchoolName,
}: {
  defaultSchoolId?: string;
  defaultSchoolName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [schoolId, setSchoolId] = useState(defaultSchoolId ?? "");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolResults, setSchoolResults] = useState<SchoolOption[]>([]);
  const [selectedSchoolName, setSelectedSchoolName] = useState(defaultSchoolName ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [planId, setPlanId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/founder/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { plans: Plan[] } | null) => { if (json) setPlans(json.plans); });
  }, [open]);

  useEffect(() => {
    if (defaultSchoolId || !schoolQuery.trim()) { setSchoolResults([]); return; }
    const id = window.setTimeout(() => {
      fetch(`/api/founder/schools?q=${encodeURIComponent(schoolQuery)}&page=1`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { schools: SchoolOption[] } | null) => setSchoolResults(json?.schools ?? []));
    }, 250);
    return () => window.clearTimeout(id);
  }, [schoolQuery, defaultSchoolId]);

  function reset() {
    setSchoolId(defaultSchoolId ?? "");
    setSelectedSchoolName(defaultSchoolName ?? "");
    setSchoolQuery("");
    setSchoolResults([]);
    setName("");
    setEmail("");
    setPlanId("");
    setError(null);
    setInviteLink(null);
  }

  async function save() {
    if (!schoolId) { setError("Select a school"); return; }
    if (!name.trim() || !email.trim()) { setError("Admin name and email are required"); return; }
    if (!planId) { setError("Select a plan"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/founder/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, name, email, planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setInviteLink(data.inviteLink ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }} className="gap-2">
        <UserPlus className="h-4 w-4" /> Invite Admin
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite School Admin</DialogTitle>
            <DialogDescription>
              They&apos;ll receive an email to set their password. No account exists until they accept.
            </DialogDescription>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Invite created. Share this link if the email didn&apos;t go through:</p>
              <Input value={inviteLink} readOnly className="text-xs font-mono bg-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>School</Label>
                {defaultSchoolId ? (
                  <Input value={selectedSchoolName} disabled />
                ) : schoolId ? (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span>{selectedSchoolName}</span>
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setSchoolId(""); setSelectedSchoolName(""); }}>
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Search school by name..." value={schoolQuery} onChange={(e) => setSchoolQuery(e.target.value)} />
                    </div>
                    {schoolResults.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                        {schoolResults.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => { setSchoolId(s.id); setSelectedSchoolName(s.name); setSchoolResults([]); }}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Admin Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              </div>

              <div className="space-y-1.5">
                <Label>Admin Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@school.edu" />
              </div>

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

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter>
            {inviteLink ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Sending..." : "Send Invite"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
