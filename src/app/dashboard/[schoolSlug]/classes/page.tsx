"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Section { id: string; name: string; _count: { students: number } }
interface Class { id: string; name: string; sections: Section[] }

export default function ClassesPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState<string>("");
  const [classes, setClasses] = useState<Class[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [addClassOpen, setAddClassOpen] = useState(false);
  const [className, setClassName] = useState("");
  const [classLoading, setClassLoading] = useState(false);

  const [addSectionOpen, setAddSectionOpen] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [sectionLoading, setSectionLoading] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`)
      .then((r) => r.json())
      .then((d) => {
        setSchoolId(d.id);
        fetchClasses(d.id);
      });
  }, [schoolSlug]);

  async function fetchClasses(sid: string) {
    setLoading(true);
    const res = await fetch(`/api/schools/${sid}/classes`);
    const data = await res.json();
    setClasses(data);
    setLoading(false);
  }

  async function addClass() {
    if (!className.trim()) return;
    setClassLoading(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: className }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setClassLoading(false); return; }
    setAddClassOpen(false);
    setClassName("");
    fetchClasses(schoolId);
    setClassLoading(false);
  }

  async function deleteClass(classId: string) {
    if (!confirm("Delete this class and all its sections and students?")) return;
    await fetch(`/api/schools/${schoolId}/classes/${classId}`, { method: "DELETE" });
    fetchClasses(schoolId);
  }

  async function addSection(classId: string) {
    if (!sectionName.trim()) return;
    setSectionLoading(true);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/classes/${classId}/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: sectionName }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSectionLoading(false); return; }
    setAddSectionOpen(null);
    setSectionName("");
    fetchClasses(schoolId);
    setSectionLoading(false);
  }

  async function deleteSection(classId: string, sectionId: string) {
    if (!confirm("Delete this section? All students in it will need to be reassigned.")) return;
    await fetch(`/api/schools/${schoolId}/classes/${classId}/sections`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId }),
    });
    fetchClasses(schoolId);
  }

  const toggleExpand = (id: string) =>
    setExpanded((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Classes & Sections</h2>
          <p className="text-sm text-gray-500 mt-1">Organise your school into classes and sections</p>
        </div>
        <Button onClick={() => { setError(""); setAddClassOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Add Class
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : classes.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No classes yet</p>
            <p className="text-gray-400 text-sm mt-1">Add your first class to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {classes.map((cls) => {
            const isOpen = expanded.includes(cls.id);
            const totalStudents = cls.sections.reduce((s, sec) => s + sec._count.students, 0);
            return (
              <Card key={cls.id}>
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 rounded-xl"
                  onClick={() => toggleExpand(cls.id)}
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <BookOpen className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{cls.name}</p>
                      <p className="text-xs text-gray-400">{cls.sections.length} sections · {totalStudents} students</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { setError(""); setSectionName(""); setAddSectionOpen(cls.id); }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Section
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteClass(cls.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <CardContent className="pt-0 pb-4 px-5">
                    {cls.sections.length === 0 ? (
                      <p className="text-sm text-gray-400 pl-11">No sections — add one above</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 pl-11">
                        {cls.sections.map((sec) => (
                          <div key={sec.id} className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-1.5">
                            <span className="text-sm font-medium text-gray-800">Section {sec.name}</span>
                            <Badge variant="secondary" className="text-xs">{sec._count.students} students</Badge>
                            <button
                              onClick={() => deleteSection(cls.id, sec.id)}
                              className="ml-1 text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Class Dialog */}
      <Dialog open={addClassOpen} onOpenChange={setAddClassOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Class</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="space-y-1.5">
              <Label>Class name</Label>
              <Input placeholder="e.g. Class 10, Grade 5" value={className} onChange={(e) => setClassName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addClass()} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddClassOpen(false)}>Cancel</Button>
            <Button onClick={addClass} disabled={classLoading}>{classLoading ? "Adding..." : "Add Class"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Section Dialog */}
      <Dialog open={!!addSectionOpen} onOpenChange={() => setAddSectionOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Section</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="space-y-1.5">
              <Label>Section name</Label>
              <Input placeholder="e.g. A, B, C" value={sectionName} onChange={(e) => setSectionName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSection(addSectionOpen!)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSectionOpen(null)}>Cancel</Button>
            <Button onClick={() => addSection(addSectionOpen!)} disabled={sectionLoading}>{sectionLoading ? "Adding..." : "Add Section"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
