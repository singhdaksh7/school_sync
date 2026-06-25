"use client";

import { useMemo, useState } from "react";
import {
  Plus, Save, Trash2, Copy, Star, Eye, Palette, LayoutTemplate, ListChecks, Layers, FileText, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Kept local (not imported from the server-coupled lib) so this stays a client bundle.
const LAYOUT_TYPES = ["CLASSIC", "MODERN", "COMPACT"] as const;
const PAPER_SIZES = ["A4_PORTRAIT", "A4_LANDSCAPE"] as const;
const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { label: "A+", min: 90, max: 100 },
  { label: "A", min: 80, max: 89 },
  { label: "B", min: 70, max: 79 },
  { label: "C", min: 60, max: 69 },
  { label: "D", min: 50, max: 59 },
  { label: "F", min: 0, max: 49 },
];

type GradeBand = { label: string; min: number; max: number };
type SubjectGroup = { name: string; subjects: string[] };
type CustomSectionField = { label: string; value: string };
type CustomSection = { key: string; title: string; fields: CustomSectionField[] };

type Template = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  assignedClassIds: string[];
  layoutType: string;
  paperSize: string;
  logoUrl: string | null;
  principalSignatureUrl: string | null;
  classTeacherSignatureEnabled: boolean;
  stampUrl: string | null;
  watermarkText: string | null;
  backgroundImageUrl: string | null;
  footerText: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  showAttendance: boolean;
  showRank: boolean;
  showGrade: boolean;
  showRemarks: boolean;
  showSubjectTeacherRemarks: boolean;
  showClassTeacherRemarks: boolean;
  showCoCurricular: boolean;
  showSkills: boolean;
  showDiscipline: boolean;
  showAwards: boolean;
  showCustomFields: boolean;
  gradeBands: GradeBand[];
  subjectGroups: SubjectGroup[];
  customSections: CustomSection[];
};

type ClassOption = { id: string; name: string };

interface Props {
  schoolId: string;
  classes: ClassOption[];
  initialTemplates: Template[];
}

const TOGGLE_FIELDS: { key: keyof Template; label: string }[] = [
  { key: "showAttendance", label: "Attendance" },
  { key: "showRank", label: "Rank" },
  { key: "showGrade", label: "Grade" },
  { key: "showRemarks", label: "Remarks" },
  { key: "showSubjectTeacherRemarks", label: "Subject teacher remarks" },
  { key: "showClassTeacherRemarks", label: "Class teacher remarks" },
  { key: "showCoCurricular", label: "Co-curricular section" },
  { key: "showSkills", label: "Skills section" },
  { key: "showDiscipline", label: "Discipline section" },
  { key: "showAwards", label: "Awards section" },
  { key: "showCustomFields", label: "Custom fields section" },
];

function blankTemplate(): Template {
  return {
    id: "",
    name: "Untitled Template",
    description: "",
    isDefault: false,
    assignedClassIds: [],
    layoutType: "CLASSIC",
    paperSize: "A4_PORTRAIT",
    logoUrl: "",
    principalSignatureUrl: "",
    classTeacherSignatureEnabled: true,
    stampUrl: "",
    watermarkText: "",
    backgroundImageUrl: "",
    footerText: "",
    primaryColor: "#2563eb",
    secondaryColor: "#0f172a",
    showAttendance: true,
    showRank: false,
    showGrade: true,
    showRemarks: true,
    showSubjectTeacherRemarks: true,
    showClassTeacherRemarks: true,
    showCoCurricular: false,
    showSkills: false,
    showDiscipline: false,
    showAwards: false,
    showCustomFields: false,
    gradeBands: DEFAULT_GRADE_BANDS,
    subjectGroups: [],
    customSections: [],
  };
}

export default function ReportCardBuilderClient({ schoolId, classes, initialTemplates }: Props) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [form, setForm] = useState<Template | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [subjectGroupClassId, setSubjectGroupClassId] = useState("");
  const [loadingGroupSubjects, setLoadingGroupSubjects] = useState(false);

  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes]
  );

  function startNew() {
    setForm(blankTemplate());
    setIsNew(true);
    setError("");
    setNotice("");
  }

  function startEdit(template: Template) {
    setForm({ ...template });
    setIsNew(false);
    setError("");
    setNotice("");
  }

  function update<K extends keyof Template>(key: K, value: Template[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleClass(classId: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const has = prev.assignedClassIds.includes(classId);
      return {
        ...prev,
        assignedClassIds: has
          ? prev.assignedClassIds.filter((id) => id !== classId)
          : [...prev.assignedClassIds, classId],
      };
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    setNotice("");
    const url = isNew
      ? `/api/schools/${schoolId}/report-card-templates`
      : `/api/schools/${schoolId}/report-card-templates/${form.id}`;
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, isDefault: isNew ? form.isDefault : undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not save template.");
      return;
    }
    const saved: Template = data.template;
    setTemplates((prev) => {
      const next = isNew ? [saved, ...prev] : prev.map((t) => (t.id === saved.id ? saved : t));
      // If this template became the default, clear others locally.
      return saved.isDefault ? next.map((t) => (t.id === saved.id ? t : { ...t, isDefault: false })) : next;
    });
    setForm({ ...saved });
    setIsNew(false);
    setNotice("Template saved.");
  }

  async function remove(template: Template) {
    if (!confirm(`Delete template "${template.name}"? Existing report cards keep their saved snapshot.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/report-card-templates/${template.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete template.");
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    if (form?.id === template.id) setForm(null);
    setNotice("Template deleted.");
  }

  async function duplicate(template: Template) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/report-card-templates/${template.id}/duplicate`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not duplicate template.");
      return;
    }
    setTemplates((prev) => [data.template, ...prev]);
    setNotice("Template duplicated.");
  }

  async function setDefault(template: Template) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/report-card-templates/${template.id}/set-default`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not set default.");
      return;
    }
    setTemplates((prev) => prev.map((t) => ({ ...t, isDefault: t.id === template.id })));
    if (form?.id === template.id) setForm((prev) => (prev ? { ...prev, isDefault: true } : prev));
    setNotice(`"${template.name}" is now the default template.`);
  }

  async function preview() {
    if (!form || isNew || !form.id) {
      setError("Save the template before previewing.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/report-card-templates/${form.id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not generate preview.");
      return;
    }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  // --- Grade band editing -------------------------------------------------
  function updateBand(index: number, patch: Partial<GradeBand>) {
    update(
      "gradeBands",
      form!.gradeBands.map((b, i) => (i === index ? { ...b, ...patch } : b))
    );
  }
  function addBand() {
    update("gradeBands", [...form!.gradeBands, { label: "", min: 0, max: 0 }]);
  }
  function removeBand(index: number) {
    update("gradeBands", form!.gradeBands.filter((_, i) => i !== index));
  }

  // --- Subject group editing ----------------------------------------------
  function addGroup() {
    update("subjectGroups", [...form!.subjectGroups, { name: "", subjects: [] }]);
  }
  function updateGroup(index: number, patch: Partial<SubjectGroup>) {
    update(
      "subjectGroups",
      form!.subjectGroups.map((g, i) => (i === index ? { ...g, ...patch } : g))
    );
  }
  function removeGroup(index: number) {
    update("subjectGroups", form!.subjectGroups.filter((_, i) => i !== index));
  }
  async function addGroupFromMaster() {
    if (!subjectGroupClassId) return;
    setLoadingGroupSubjects(true);
    const res = await fetch(`/api/schools/${schoolId}/subjects?classId=${subjectGroupClassId}`);
    const data = await res.json();
    setLoadingGroupSubjects(false);
    if (!res.ok || !Array.isArray(data) || data.length === 0) {
      setError("No subjects found for that class in Subject Master.");
      return;
    }
    const className = classNameById.get(subjectGroupClassId) ?? "Subjects";
    update("subjectGroups", [
      ...form!.subjectGroups,
      { name: className, subjects: data.map((s: { name: string }) => s.name) },
    ]);
  }

  // --- Custom section editing ---------------------------------------------
  function addSection() {
    update("customSections", [...form!.customSections, { key: "", title: "", fields: [] }]);
  }
  function updateSection(index: number, patch: Partial<CustomSection>) {
    update(
      "customSections",
      form!.customSections.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }
  function removeSection(index: number) {
    update("customSections", form!.customSections.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6 text-blue-600" /> Report Card Builder
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Design report card templates. Published report cards keep a snapshot, so editing a template never changes old cards.
          </p>
        </div>
        <Button onClick={startNew} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
      {notice && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Template list */}
        <div className="space-y-3">
          {templates.length === 0 && (
            <Card>
              <CardContent className="py-6 text-sm text-gray-500">
                No templates yet. Report cards use the default layout until you create one.
              </CardContent>
            </Card>
          )}
          {templates.map((template) => (
            <Card key={template.id} className={form?.id === template.id ? "border-blue-400" : ""}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button className="font-medium text-gray-900 text-left hover:text-blue-600" onClick={() => startEdit(template)}>
                    {template.name}
                  </button>
                  {template.isDefault && <Badge variant="secondary" className="gap-1"><Star className="w-3 h-3" /> Default</Badge>}
                </div>
                <p className="text-xs text-gray-500">
                  {template.layoutType} · {template.paperSize.replace("_", " ")}
                  {template.assignedClassIds.length > 0 && ` · ${template.assignedClassIds.length} class(es)`}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => startEdit(template)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => duplicate(template)} disabled={busy}>
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                  {!template.isDefault && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDefault(template)} disabled={busy}>
                      <Star className="w-3 h-3" /> Default
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-red-600" onClick={() => remove(template)} disabled={busy}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Editor */}
        {!form ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-gray-500">
              Select a template to edit, or create a new one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" /> {isNew ? "New Template" : "Edit Template"}
                </CardTitle>
                <CardDescription>Name, default flag, and class assignment.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Template Name</Label>
                    <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} />
                  </div>
                </div>

                {isNew && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isDefault} onChange={(e) => update("isDefault", e.target.checked)} />
                    Make this the school default template
                  </label>
                )}

                <div className="space-y-2">
                  <Label>Assigned Classes</Label>
                  <p className="text-xs text-gray-400">Report cards for these classes use this template. Unassigned classes fall back to the default.</p>
                  <div className="flex flex-wrap gap-2">
                    {classes.length === 0 && <span className="text-xs text-gray-400">No classes yet.</span>}
                    {classes.map((c) => {
                      const active = form.assignedClassIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleClass(c.id)}
                          className={`px-3 py-1 rounded-full border text-xs ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Layout */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-blue-600" /> Layout</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Layout Type</Label>
                    <select
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm"
                      value={form.layoutType}
                      onChange={(e) => update("layoutType", e.target.value)}
                    >
                      {LAYOUT_TYPES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Paper Size</Label>
                    <select
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm"
                      value={form.paperSize}
                      onChange={(e) => update("paperSize", e.target.value)}
                    >
                      {PAPER_SIZES.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TOGGLE_FIELDS.map((field) => (
                    <label key={field.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(form[field.key])}
                        onChange={(e) => update(field.key, e.target.checked as Template[typeof field.key])}
                      />
                      {field.label}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.classTeacherSignatureEnabled}
                      onChange={(e) => update("classTeacherSignatureEnabled", e.target.checked)}
                    />
                    Class teacher signature
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Branding */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Palette className="w-4 h-4 text-blue-600" /> Branding</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="School Logo URL" value={form.logoUrl} onChange={(v) => update("logoUrl", v)} />
                  <TextField label="Principal Signature URL" value={form.principalSignatureUrl} onChange={(v) => update("principalSignatureUrl", v)} />
                  <TextField label="School Stamp URL" value={form.stampUrl} onChange={(v) => update("stampUrl", v)} />
                  <TextField label="Background Image URL" value={form.backgroundImageUrl} onChange={(v) => update("backgroundImageUrl", v)} />
                  <TextField label="Watermark Text" value={form.watermarkText} onChange={(v) => update("watermarkText", v)} />
                  <TextField label="Footer Text" value={form.footerText} onChange={(v) => update("footerText", v)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField label="Primary Color" value={form.primaryColor ?? "#2563eb"} onChange={(v) => update("primaryColor", v)} />
                  <ColorField label="Secondary Color" value={form.secondaryColor ?? "#0f172a"} onChange={(v) => update("secondaryColor", v)} />
                </div>
              </CardContent>
            </Card>

            {/* Grade bands */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4 text-blue-600" /> Grade Bands</CardTitle>
                <CardDescription>Letter grade per percentage range. Used when generating new report cards with this template.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {form.gradeBands.map((band, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="w-20" placeholder="A+" value={band.label} onChange={(e) => updateBand(i, { label: e.target.value })} />
                    <Input className="w-24" type="number" placeholder="min" value={band.min} onChange={(e) => updateBand(i, { min: Number(e.target.value) })} />
                    <span className="text-gray-400">to</span>
                    <Input className="w-24" type="number" placeholder="max" value={band.max} onChange={(e) => updateBand(i, { max: Number(e.target.value) })} />
                    <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => removeBand(i)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="gap-1" onClick={addBand}><Plus className="w-3 h-3" /> Add band</Button>
              </CardContent>
            </Card>

            {/* Subject groups */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" /> Subject Groups</CardTitle>
                <CardDescription>Optional grouping (e.g. Scholastic, Co-Scholastic). Comma-separate subjects.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {form.subjectGroups.map((group, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="w-40" placeholder="Group name" value={group.name} onChange={(e) => updateGroup(i, { name: e.target.value })} />
                    <Input
                      className="flex-1"
                      placeholder="Math, Science, English"
                      value={group.subjects.join(", ")}
                      onChange={(e) => updateGroup(i, { subjects: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    />
                    <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => removeGroup(i)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="gap-1" onClick={addGroup}><Plus className="w-3 h-3" /> Add group</Button>
                {classes.length > 0 && (
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <Select value={subjectGroupClassId} onValueChange={setSubjectGroupClassId}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="Pick a class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={addGroupFromMaster}
                      disabled={!subjectGroupClassId || loadingGroupSubjects}
                    >
                      <Plus className="w-3 h-3" /> {loadingGroupSubjects ? "Loading..." : "Add group from Subject Master"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Custom sections */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" /> Custom Sections</CardTitle>
                <CardDescription>Define co-curricular, skills, discipline, awards or custom-field sections. Key controls which toggle shows it (e.g. &quot;skills&quot;, &quot;awards&quot;, or &quot;custom&quot;).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {form.customSections.map((section, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input className="w-40" placeholder="key (e.g. skills)" value={section.key} onChange={(e) => updateSection(i, { key: e.target.value })} />
                      <Input className="flex-1" placeholder="Section title" value={section.title} onChange={(e) => updateSection(i, { title: e.target.value })} />
                      <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => removeSection(i)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                    <Input
                      placeholder="Fields as label:value, comma-separated (e.g. Music:A, Sports:B)"
                      value={section.fields.map((f) => `${f.label}:${f.value}`).join(", ")}
                      onChange={(e) =>
                        updateSection(i, {
                          fields: e.target.value
                            .split(",")
                            .map((pair) => pair.split(":"))
                            .filter((parts) => parts[0]?.trim())
                            .map((parts) => ({ label: parts[0].trim(), value: (parts[1] ?? "").trim() })),
                        })
                      }
                    />
                  </div>
                ))}
                <Button size="sm" variant="outline" className="gap-1" onClick={addSection}><Plus className="w-3 h-3" /> Add section</Button>
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Template
              </Button>
              <Button onClick={preview} disabled={busy || isNew} variant="outline" className="gap-2">
                <Eye className="w-4 h-4" /> Preview (sample data)
              </Button>
              {!isNew && form.assignedClassIds.length > 0 && (
                <span className="self-center text-xs text-gray-500">
                  Assigned: {form.assignedClassIds.map((id) => classNameById.get(id) ?? id).join(", ")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input type="color" className="w-14 px-1" value={value} onChange={(e) => onChange(e.target.value)} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
