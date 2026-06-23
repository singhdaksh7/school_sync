"use client";

import { useEffect, useState } from "react";
import { BookCheck, Check, X as XIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface MilestoneStatus { examMilestoneId: string; name: string; checked: boolean; checkedAt: string | null }
interface SubjectGrid { subject: string; milestones: MilestoneStatus[]; checkedCount: number; totalCount: number; percentage: number | null }
interface NotebookSummary {
  subjects: SubjectGrid[];
  overallCheckedCount: number;
  overallTotalCount: number;
  overallPercentage: number | null;
}

export default function StudentNotebookPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<NotebookSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/notebook")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("studentNotebook.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studentNotebook.subtitle")}</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : !data || data.subjects.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <BookCheck className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-foreground">{t("studentNotebook.noChecksYet")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("studentNotebook.noChecksHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border">
            <CardContent className="flex flex-wrap items-center gap-6 p-4">
              <CircularProgress value={data.overallPercentage ?? 0} size={84} strokeWidth={9} />
              <div className="flex-1 min-w-[200px] space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  {t("studentNotebook.checksCompleted", { checked: data.overallCheckedCount, total: data.overallTotalCount })}
                </p>
                <Progress value={data.overallPercentage ?? 0} toned />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {data.subjects.map((subject) => (
              <Card key={subject.subject} className="border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{subject.subject}</p>
                    <Badge variant={subject.percentage !== null && subject.percentage >= 90 ? "success" : subject.percentage !== null && subject.percentage >= 70 ? "warning" : "destructive"}>
                      {subject.checkedCount}/{subject.totalCount} - {subject.percentage === null ? "-" : `${subject.percentage}%`}
                    </Badge>
                  </div>
                  <Progress value={subject.percentage ?? 0} toned />
                  <div className="flex flex-wrap gap-2">
                    {subject.milestones.map((m) => (
                      <span
                        key={m.examMilestoneId}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                          m.checked ? "border-green-200 bg-green-50 text-green-700" : "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        {m.checked ? <Check className="h-3 w-3" /> : <XIcon className="h-3 w-3" />} {m.name}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
