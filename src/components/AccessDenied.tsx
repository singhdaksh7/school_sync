import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface AccessDeniedProps {
  title?: string;
  message?: string;
}

export default function AccessDenied({
  title = "Access denied",
  message = "You don't have permission to do this. Ask a school admin to grant the required permission.",
}: AccessDeniedProps) {
  return (
    <Card className="border-border">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
