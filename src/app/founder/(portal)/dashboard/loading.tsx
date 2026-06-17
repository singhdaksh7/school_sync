import { Card, CardContent, CardHeader } from "@/components/ui/card";

function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function FounderDashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl border border-border p-6 md:p-7">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="mt-3 h-7 w-72" />
        <Shimmer className="mt-2 h-4 w-56" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i} className="border-border">
            <CardContent className="p-5">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="mt-2 h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <Shimmer className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Shimmer key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardHeader>
            <Shimmer className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
