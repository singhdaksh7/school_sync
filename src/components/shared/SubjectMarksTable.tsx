import { Badge } from "@/components/ui/badge";

export interface SubjectMark {
  subject: string;
  marks: number;
  maxMarks: number;
  grade: string;
  subjectTeacherRemark?: string | null;
}

interface SubjectMarksTableLabels {
  subject?: string;
  marks?: string;
  grade?: string;
  teacherRemark?: string;
  totalMarks?: string;
  percentage?: string;
}

export default function SubjectMarksTable({
  subjects,
  totalMarks,
  percentage,
  grade,
  showRemarks = false,
  labels,
}: {
  subjects: SubjectMark[];
  totalMarks: number;
  percentage: number;
  grade: string;
  showRemarks?: boolean;
  labels?: SubjectMarksTableLabels;
}) {
  const l = {
    subject: labels?.subject ?? "Subject",
    marks: labels?.marks ?? "Marks",
    grade: labels?.grade ?? "Grade",
    teacherRemark: labels?.teacherRemark ?? "Teacher Remark",
    totalMarks: labels?.totalMarks ?? "Total Marks",
    percentage: labels?.percentage ?? "Percentage",
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-4 rounded-lg bg-muted/40 p-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">{l.totalMarks}</p>
          <p className="text-lg font-bold text-foreground">{totalMarks}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{l.percentage}</p>
          <p className="text-lg font-bold text-foreground">{percentage.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{l.grade}</p>
          <p className="text-lg font-bold text-foreground">{grade}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 font-medium">{l.subject}</th>
              <th className="py-2 font-medium">{l.marks}</th>
              <th className="py-2 font-medium">{l.grade}</th>
              {showRemarks && <th className="py-2 font-medium">{l.teacherRemark}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {subjects.map((s) => (
              <tr key={s.subject}>
                <td className="py-2 font-medium text-foreground">{s.subject}</td>
                <td className="py-2 text-foreground">{s.marks} / {s.maxMarks}</td>
                <td className="py-2"><Badge variant="outline">{s.grade}</Badge></td>
                {showRemarks && <td className="py-2 text-muted-foreground">{s.subjectTeacherRemark || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
