"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BookCheck, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Milestone { id: string; name: string; sequence: number; active: boolean }
interface MilestoneStat { examMilestoneId: string; name: string; totalRows: number; checkedRows: number; percentage: number | null }
interface Analytics { milestoneStats: MilestoneStat[]; studentsWithZeroChecks: number; totalStudents: number }

interface Props { initialMilestones: Milestone[]; schoolId: string }

export default function ExamMilestonesClient({ initialMilestones, schoolId }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/schools/${schoolId}/exam-milestones/analytics`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAnalytics(d); });
  }, [schoolId]);

  async function refresh() {
    const res = await fetch(`/api/schools/${schoolId}/exam-milestones`);
    setMilestones(await res.json());
  }

  function openAdd() {
    setName("");
    setError("");
    setDialogOpen(true);
  }

  async function save() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/exam-milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error); return; }
    setDialogOpen(false);
    await refresh();
  }

  async function patchMilestone(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/schools/${schoolId}/exam-milestones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
    setBusyId(null);
  }

  async function toggleActive(milestone: Milestone) {
    await patchMilestone(milestone.id, { active: !milestone.active });
  }

  async function move(milestone: Milestone, direction: -1 | 1) {
    const sorted = [...milestones].sort((a, b) => a.sequence - b.sequence);
    const index = sorted.findIndex((m) => m.id === milestone.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const other = sorted[swapIndex];
    setBusyId(milestone.id);
    await Promise.all([
      fetch(`/api/schools/${schoolId}/exam-milestones/${milestone.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: other.sequence }),
      }),
      fetch(`/api/schools/${schoolId}/exam-milestones/${other.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: milestone.sequence }),
      }),
    ]);
    await refresh();
    setBusyId(null);
  }

  const sorted = [...milestones].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Exam Milestones</h2>
          <p className="text-sm text-gray-500 mt-1">Configure the notebook-checking milestones for this school (e.g. UT-1, Half Yearly, Final).</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add Milestone</Button>
      </div>

      {analytics && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-gray-900">Notebook Checking Analytics</p>
              <Badge variant="outline" className="ml-auto">{analytics.studentsWithZeroChecks} / {analytics.totalStudents} students with no checks yet</Badge>
            </div>
            <div className="space-y-2">
              {analytics.milestoneStats.map((stat) => (
                <div key={stat.examMilestoneId} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate font-medium text-gray-800">{stat.name}</span>
                  <Progress value={stat.percentage ?? 0} toned className="flex-1" />
                  <span className="w-28 shrink-0 text-right text-xs text-gray-500">
                    {stat.checkedRows}/{stat.totalRows} - {stat.percentage === null ? "-" : `${stat.percentage}%`}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {sorted.length === 0 ? (
        <Card><CardContent className="py-20 text-center"><BookCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">No exam milestones yet</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((milestone, index) => (
            <Card key={milestone.id}>
              <div className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(milestone, -1)}
                      disabled={index === 0 || busyId === milestone.id}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => move(milestone, 1)}
                      disabled={index === sorted.length - 1 || busyId === milestone.id}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <BookCheck className="w-4 h-4 text-indigo-600" />
                  </div>
                  <p className={milestone.active ? "font-semibold text-gray-900" : "font-semibold text-gray-400 line-through"}>{milestone.name}</p>
                  {!milestone.active && <Badge variant="secondary">Disabled</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{milestone.active ? "Active" : "Inactive"}</span>
                  <Switch checked={milestone.active} disabled={busyId === milestone.id} onCheckedChange={() => toggleActive(milestone)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Exam Milestone</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="milestone-name">Name</Label>
            <Input id="milestone-name" placeholder="e.g. UT-1" value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
