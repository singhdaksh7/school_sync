import { GraduationCap } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NoSchoolPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SchoolSync</span>
          </div>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Your account isn&apos;t linked to a school yet</CardTitle>
            <CardDescription>
              School accounts on SchoolSync are set up by your school&apos;s administrator, who can invite you,
              or by SchoolSync itself. If you believe this is a mistake, contact whoever manages your school&apos;s
              SchoolSync account.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
