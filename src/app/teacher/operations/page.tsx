"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import OperationsCommandCenter from "@/components/operations/OperationsCommandCenter";

/** Fields this page reads from the raw Teacher DTO returned by GET /api/teacher/me. */
interface TeacherProfile {
  id: string;
  school: { id: string; slug: string };
}

/** Matches GET /api/teacher/operational-roles/self-status's response exactly. */
interface SelfStatus {
  roleType: string;
  isEffectiveOperationsHead: boolean;
  delegated: boolean;
  reasonCode: string | null;
}

export default function TeacherOperationsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [selfStatus, setSelfStatus] = useState<SelfStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/teacher/me"),
        fetch("/api/teacher/operational-roles/self-status"),
      ]);

      // A 401 means the session itself is gone (expired/revoked) — that is
      // NOT the same condition as "not currently delegated" (which the
      // self-status endpoint reports as ok:false/403). Session loss must
      // redirect to login, never render the "standby inactive" message.
      if (pRes.status === 401 || sRes.status === 401) {
        router.replace("/login");
        return;
      }

      if (pRes.ok && sRes.ok) {
        const pData = await pRes.json();
        const sData = await sRes.json();
        setProfile(pData);
        setSelfStatus(sData);
      } else {
        setSelfStatus({ roleType: "TEACHER_OPERATIONS", isEffectiveOperationsHead: false, delegated: false, reasonCode: null });
      }
    } catch (e) {
      console.error(e);
      setSelfStatus({ roleType: "TEACHER_OPERATIONS", isEffectiveOperationsHead: false, delegated: false, reasonCode: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 30 seconds for dynamic delegation gain/loss
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="py-24 text-center text-gray-400 flex flex-col items-center max-w-5xl mx-auto">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <span className="text-sm">Verifying delegation authorization status...</span>
      </div>
    );
  }

  if (!selfStatus?.isEffectiveOperationsHead) {
    return (
      <div className="p-6 max-w-3xl mx-auto mt-12">
        <Card className="border-red-200 bg-red-50/10 shadow-sm">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-red-600" />
              Access Denied: Standby Alternate Inactive
            </CardTitle>
            <CardDescription className="text-red-700">
              You are not currently delegated as the effective Operations Head.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <p>
              Your user account is either not configured in the School Operations delegation chain of command, 
              or the primary administrator is currently active.
            </p>
            <p className="font-semibold text-gray-700">
              Standby alternates do not receive operational delegation or mutation rights while backup status is inactive.
            </p>
            <div className="pt-2 text-xs text-gray-400">
              This status is checked dynamically and refreshed every 30 seconds. If delegation is turned on, this page will automatically unlock.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile) {
    // Invariant: fetchStatus only ever sets isEffectiveOperationsHead=true
    // together with profile in the same successful response — this is
    // unreachable in practice, guarded here only to satisfy strict null
    // checks without changing behavior.
    return null;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-200 p-4 rounded-xl">
        <ShieldAlert className="w-5 h-5 text-blue-600 shrink-0" />
        <div className="text-xs text-blue-900 leading-normal">
          <p className="font-bold">Active Delegation Mode Enabled</p>
          <p className="mt-0.5">
            You are logged in as the effective Operations Head today. 
            {selfStatus.reasonCode && <span className="font-semibold"> Reason Code: {selfStatus.reasonCode}</span>}
          </p>
        </div>
      </div>

      <OperationsCommandCenter
        schoolId={profile.school.id}
        userRole="TEACHER"
        isEffectiveTeacher={true}
        teacherId={profile.id}
        schoolSlug={profile.school.slug}
        onForbiddenAction={() => {
          // Dynamic authority loss action
          setSelfStatus((prev) => (prev ? { ...prev, isEffectiveOperationsHead: false } : prev));
        }}
      />
    </div>
  );
}
