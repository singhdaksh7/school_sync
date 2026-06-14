"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, ShieldCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Permission {
  module: string;
  action: string;
  allowed: boolean;
}
interface Role {
  id: string;
  name: string;
  description: string | null;
  assignmentCount: number;
  permissions: Permission[];
}
interface Section {
  id: string;
  name: string;
}
interface ClassItem {
  id: string;
  name: string;
  sections: Section[];
}
interface Assignment {
  id: string;
  role: { id: string; name: string };
}
interface TeacherItem {
  id: string;
  name: string;
  assignments: Assignment[];
}

interface Props {
  schoolId: string;
  catalog: Record<string, readonly string[]>;
  initialRoles: Role[];
  initialTeachers: TeacherItem[];
  initialClasses: ClassItem[];
}

export default function TeacherRolesClient({
  schoolId,
  catalog,
  initialRoles,
  initialTeachers,
  initialClasses,
}: Props) {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [teachers, setTeachers] = useState<TeacherItem[]>(initialTeachers);
  const modules = useMemo(() => Object.keys(catalog), [catalog]);

  // Create-role dialog state
  const [roleOpen, setRoleOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingRole, setSavingRole] = useState(false);
  const [roleError, setRoleError] = useState("");

  // Assign-role dialog state
  const [assignOpen, setAssignOpen] = useState(false);
  const [teacherId, setTeacherId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [classIds, setClassIds] = useState<Set<string>>(new Set());
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [savingAssign, setSavingAssign] = useState(false);
  const [assignError, setAssignError] = useState("");

  function toggle(set: Set<string>, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function resetRoleForm() {
    setName("");
    setDescription("");
    setSelected(new Set());
    setRoleError("");
  }

  async function createRole() {
    setRoleError("");
    if (name.trim().length < 2) {
      setRoleError("Role name must be at least 2 characters.");
      return;
    }
    const permissions = Array.from(selected).map((key) => {
      const [module, action] = key.split(":");
      return { module, action, allowed: true };
    });
    setSavingRole(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/teacher-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), permissions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create role.");
      const role: Role = {
        id: data.role.id,
        name: data.role.name,
        description: data.role.description,
        assignmentCount: 0,
        permissions: data.role.permissions.map((p: Permission) => ({
          module: p.module,
          action: p.action,
          allowed: p.allowed,
        })),
      };
      setRoles((prev) => [...prev, role].sort((a, b) => a.name.localeCompare(b.name)));
      setRoleOpen(false);
      resetRoleForm();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Failed to create role.");
    } finally {
      setSavingRole(false);
    }
  }

  async function deleteRole(role: Role) {
    if (!confirm(`Delete role "${role.name}"? This also removes it from any assigned teachers.`)) return;
    const res = await fetch(`/api/schools/${schoolId}/teacher-roles/${role.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete role.");
      return;
    }
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
    setTeachers((prev) =>
      prev.map((t) => ({ ...t, assignments: t.assignments.filter((a) => a.role.id !== role.id) }))
    );
  }

  function resetAssignForm() {
    setTeacherId("");
    setAssignRoleId("");
    setClassIds(new Set());
    setSectionIds(new Set());
    setAssignError("");
  }

  async function assignRole() {
    setAssignError("");
    if (!teacherId || !assignRoleId) {
      setAssignError("Select both a teacher and a role.");
      return;
    }
    setSavingAssign(true);
    try {
      const res = await fetch(`/api/schools/${schoolId}/teachers/${teacherId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: assignRoleId,
          classIds: Array.from(classIds),
          sectionIds: Array.from(sectionIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign role.");
      const newAssignment: Assignment = { id: data.assignment.id, role: data.assignment.role };
      setTeachers((prev) =>
        prev.map((t) =>
          t.id === teacherId
            ? {
                ...t,
                assignments: [
                  newAssignment,
                  ...t.assignments.filter((a) => a.role.id !== newAssignment.role.id),
                ],
              }
            : t
        )
      );
      setRoles((prev) =>
        prev.map((r) =>
          r.id === assignRoleId
            ? {
                ...r,
                assignmentCount: teachers
                  .find((t) => t.id === teacherId)
                  ?.assignments.some((a) => a.role.id === assignRoleId)
                  ? r.assignmentCount
                  : r.assignmentCount + 1,
              }
            : r
        )
      );
      setAssignOpen(false);
      resetAssignForm();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign role.");
    } finally {
      setSavingAssign(false);
    }
  }

  async function removeAssignment(teacher: TeacherItem, assignment: Assignment) {
    const res = await fetch(
      `/api/schools/${schoolId}/teachers/${teacher.id}/roles/${assignment.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to remove assignment.");
      return;
    }
    setTeachers((prev) =>
      prev.map((t) =>
        t.id === teacher.id
          ? { ...t, assignments: t.assignments.filter((a) => a.id !== assignment.id) }
          : t
      )
    );
    setRoles((prev) =>
      prev.map((r) =>
        r.id === assignment.role.id
          ? { ...r, assignmentCount: Math.max(0, r.assignmentCount - 1) }
          : r
      )
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Teacher Roles &amp; Permissions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create custom roles, choose what each role can access, and assign them to teachers with an
            optional class/section scope.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { resetAssignForm(); setAssignOpen(true); }}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Assign Role
          </Button>
          <Button onClick={() => { resetRoleForm(); setRoleOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Create Role
          </Button>
        </div>
      </div>

      {/* Roles list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Roles</h2>
        {roles.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No custom roles yet. Create one to control teacher access.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {roles.map((role) => (
              <Card key={role.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{role.name}</p>
                      {role.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {role.assignmentCount} teacher{role.assignmentCount === 1 ? "" : "s"} assigned
                      </p>
                    </div>
                    <button
                      onClick={() => deleteRole(role)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {role.permissions.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No permissions selected.</span>
                    ) : (
                      role.permissions.map((p) => (
                        <Badge key={`${p.module}:${p.action}`} variant="secondary" className="text-[10px]">
                          {p.module}:{p.action}
                        </Badge>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Teacher assignments */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Roles by Teacher
        </h2>
        <Card>
          <CardContent className="divide-y p-0">
            {teachers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No teachers found.</p>
            ) : (
              teachers.map((teacher) => (
                <div key={teacher.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="min-w-[8rem] font-medium">{teacher.name}</span>
                  {teacher.assignments.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No custom roles</span>
                  ) : (
                    teacher.assignments.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {a.role.name}
                        <button
                          onClick={() => removeAssignment(teacher, a)}
                          aria-label="Remove role"
                          className="rounded-full hover:bg-primary/20"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* Create-role dialog */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="role-name">Role name</Label>
                <Input
                  id="role-name"
                  placeholder="e.g. Head Teacher 5-10"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="role-desc">Description (optional)</Label>
                <Input
                  id="role-desc"
                  placeholder="What this role can do"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>
              {modules.map((module) => (
                <div key={module} className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {module}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {catalog[module].map((action) => {
                      const key = `${module}:${action}`;
                      return (
                        <label key={key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={selected.has(key)}
                            onChange={() => setSelected((s) => toggle(s, key))}
                          />
                          {action}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {roleError ? <p className="text-sm text-destructive">{roleError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleOpen(false)} disabled={savingRole}>
              Cancel
            </Button>
            <Button onClick={createRole} disabled={savingRole}>
              {savingRole ? "Saving..." : "Create Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign-role dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign Role to Teacher</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Teacher</Label>
                <Select value={teacherId} onValueChange={setTeacherId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Role</Label>
                <Select value={assignRoleId} onValueChange={setAssignRoleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Class / Section scope (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Leave everything unchecked to apply the role school-wide.
              </p>
              <div className="space-y-2">
                {initialClasses.map((cls) => (
                  <div key={cls.id} className="rounded-lg border p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={classIds.has(cls.id)}
                        onChange={() => setClassIds((s) => toggle(s, cls.id))}
                      />
                      Class {cls.name}
                    </label>
                    {cls.sections.length > 0 ? (
                      <div className="ml-6 mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {cls.sections.map((sec) => (
                          <label key={sec.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={sectionIds.has(sec.id)}
                              onChange={() => setSectionIds((s) => toggle(s, sec.id))}
                            />
                            {cls.name}-{sec.name}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {assignError ? <p className="text-sm text-destructive">{assignError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={savingAssign}>
              Cancel
            </Button>
            <Button onClick={assignRole} disabled={savingAssign}>
              {savingAssign ? "Saving..." : "Assign Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
