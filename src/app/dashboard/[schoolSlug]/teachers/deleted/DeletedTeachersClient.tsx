"use client";

import { useState } from "react";
import Link from "next/link";
import { UserMinus, RotateCcw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DeletedTeacher {
  id: string;
  name: string;
  subject: string | null;
  createdAt: string | Date;
  deletedAt: string | Date | null;
  deletedBy: { id: string; name: string } | null;
  classesHandled: string[];
  sectionsHandled: string[];
}

function formatDate(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function DeletedTeachersClient({
  initialTeachers,
  schoolId,
  schoolSlug,
}: {
  initialTeachers: DeletedTeacher[];
  schoolId: string;
  schoolSlug: string;
}) {
  const [teachers, setTeachers] = useState(initialTeachers);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function restore(id: string) {
    setRestoringId(id);
    setError("");
    const res = await fetch(`/api/schools/${schoolId}/teachers/${id}/restore`, { method: "POST" });
    setRestoringId(null);
    if (!res.ok) {
      setError("Could not restore the teacher. Please try again.");
      return;
    }
    setTeachers((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Deleted Teachers History</h2>
        <p className="text-sm text-gray-500 mt-1">
          Teachers removed from active duty. All their historical records are preserved and can be restored.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

      {teachers.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <UserMinus className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No deleted teachers</p>
            <p className="text-gray-400 text-sm mt-1">Removed teachers will show up here for history and recovery.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-3 px-3 font-medium">Teacher</th>
                  <th className="py-3 px-3 font-medium">Subject</th>
                  <th className="py-3 px-3 font-medium">Joined</th>
                  <th className="py-3 px-3 font-medium">Deleted</th>
                  <th className="py-3 px-3 font-medium">Classes / Sections</th>
                  <th className="py-3 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50">
                    <td className="py-3 px-3 font-medium text-gray-900">{t.name}</td>
                    <td className="py-3 px-3 text-gray-600">{t.subject || "—"}</td>
                    <td className="py-3 px-3 text-gray-600">{formatDate(t.createdAt)}</td>
                    <td className="py-3 px-3 text-gray-600">
                      {formatDate(t.deletedAt)}
                      {t.deletedBy && <p className="text-xs text-gray-400">by {t.deletedBy.name}</p>}
                    </td>
                    <td className="py-3 px-3">
                      {t.classesHandled.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {t.sectionsHandled.slice(0, 4).map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                          ))}
                          {t.sectionsHandled.length > 4 && (
                            <Badge variant="secondary" className="text-xs">+{t.sectionsHandled.length - 4}</Badge>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" className="gap-2" asChild>
                          <Link href={`/dashboard/${schoolSlug}/teachers/deleted/${t.id}`}>
                            <Eye className="w-4 h-4" /> View
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => restore(t.id)}
                          disabled={restoringId === t.id}
                        >
                          <RotateCcw className="w-4 h-4" /> {restoringId === t.id ? "Restoring..." : "Restore"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
