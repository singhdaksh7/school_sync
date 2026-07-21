"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Cycle = {
  id: string;
  sessionLabel: string;
  name: string;
  applicationStartAt: string;
  applicationEndAt: string;
  status: string;
};
type Offering = { id: string; classId: string; className: string | null; capacity: number; applicationsOpen: boolean };

const CYCLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN", "ARCHIVED"],
  OPEN: ["CLOSED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

export default function CyclesClient({
  schoolId,
  initialCycles,
  classes,
}: {
  schoolId: string;
  initialCycles: Cycle[];
  classes: { id: string; name: string }[];
}) {
  const [cycles, setCycles] = useState(initialCycles);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ sessionLabel: "", name: "", applicationStartAt: "", applicationEndAt: "" });
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [newOffering, setNewOffering] = useState({ classId: "", capacity: "0" });

  const reload = useCallback(async () => {
    const res = await fetch(`/api/schools/${schoolId}/admissions/cycles?limit=100`);
    if (res.ok) setCycles((await res.json()).data);
  }, [schoolId]);

  async function createCycle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`/api/schools/${schoolId}/admissions/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create cycle");
      setForm({ sessionLabel: "", name: "", applicationStartAt: "", applicationEndAt: "" });
      setCreating(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create cycle");
    }
  }

  async function setCycleStatus(cycleId: string, status: string) {
    setError(null);
    try {
      const res = await fetch(`/api/schools/${schoolId}/admissions/cycles/${cycleId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update cycle status");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cycle status");
    }
  }

  async function loadOfferings(cycleId: string) {
    setExpandedCycleId(cycleId === expandedCycleId ? null : cycleId);
    if (cycleId === expandedCycleId) return;
    const res = await fetch(`/api/schools/${schoolId}/admissions/cycles/${cycleId}/offerings`);
    if (res.ok) setOfferings(await res.json());
  }

  async function addOffering(cycleId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/schools/${schoolId}/admissions/cycles/${cycleId}/offerings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: newOffering.classId, capacity: Number(newOffering.capacity) || 0, applicationsOpen: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add offering");
      setNewOffering({ classId: "", capacity: "0" });
      const refreshed = await fetch(`/api/schools/${schoolId}/admissions/cycles/${cycleId}/offerings`);
      if (refreshed.ok) setOfferings(await refreshed.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add offering");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admission cycles</h1>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New cycle"}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>Create cycle</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCycle} className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Session label (e.g. 2026-27)</Label>
                <Input required value={form.sessionLabel} onChange={(e) => setForm((f) => ({ ...f, sessionLabel: e.target.value }))} />
              </div>
              <div>
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Applications open from</Label>
                <Input type="datetime-local" required value={form.applicationStartAt} onChange={(e) => setForm((f) => ({ ...f, applicationStartAt: e.target.value }))} />
              </div>
              <div>
                <Label>Applications close on</Label>
                <Input type="datetime-local" required value={form.applicationEndAt} onChange={(e) => setForm((f) => ({ ...f, applicationEndAt: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Create</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {cycles.map((cycle) => (
          <Card key={cycle.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  {cycle.name} ({cycle.sessionLabel})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {new Date(cycle.applicationStartAt).toLocaleDateString()} – {new Date(cycle.applicationEndAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={cycle.status === "OPEN" ? "success" : "outline"}>{cycle.status}</Badge>
                {(CYCLE_TRANSITIONS[cycle.status] ?? []).map((next) => (
                  <Button key={next} size="sm" variant="outline" onClick={() => setCycleStatus(cycle.id, next)}>
                    {next === "OPEN" ? "Open" : next === "CLOSED" ? "Close" : "Archive"}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => loadOfferings(cycle.id)}>
                  {expandedCycleId === cycle.id ? "Hide offerings" : "Offerings"}
                </Button>
              </div>
            </CardHeader>
            {expandedCycleId === cycle.id && (
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-4">Class</th>
                        <th className="py-2 pr-4">Capacity</th>
                        <th className="py-2 pr-4">Accepting applications</th>
                      </tr>
                    </thead>
                    <tbody>
                      {offerings.map((o) => (
                        <tr key={o.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{o.className}</td>
                          <td className="py-2 pr-4">{o.capacity}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={o.applicationsOpen ? "success" : "secondary"}>{o.applicationsOpen ? "Open" : "Closed"}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-end gap-3">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={newOffering.classId}
                    onChange={(e) => setNewOffering((f) => ({ ...f, classId: e.target.value }))}
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    className="w-24"
                    value={newOffering.capacity}
                    onChange={(e) => setNewOffering((f) => ({ ...f, capacity: e.target.value }))}
                  />
                  <Button size="sm" onClick={() => addOffering(cycle.id)} disabled={!newOffering.classId}>
                    Add offering
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
