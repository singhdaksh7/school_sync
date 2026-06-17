import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface FounderComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function FounderComingSoon({ icon: Icon, title, description }: FounderComingSoonProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
      </div>
      <Card className="border-border">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Icon className="h-7 w-7" />
          </div>
          <p className="text-base font-semibold text-foreground">Coming soon</p>
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
