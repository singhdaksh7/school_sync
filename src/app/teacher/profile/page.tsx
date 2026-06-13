"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { User, Building2, Users, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TeacherProfile {
  name: string;
  subject?: string | null;
  school: { name: string };
  mentorSection: { name: string; class: { name: string }; students: unknown[] } | null;
}

export default function TeacherProfilePage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/teacher/me")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setProfile(d); })
      .catch(() => setError("Unable to load profile"));
  }, []);

  const initials = (profile?.name || "")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 md:px-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Profile</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Your account and assignment details.</p>
      </div>

      {error ? (
        <Card className="dark:border-gray-800 dark:bg-gray-950">
          <CardContent className="py-12 text-center text-red-600">{error}</CardContent>
        </Card>
      ) : !profile ? (
        <div className="py-20 text-center text-gray-400">Loading...</div>
      ) : (
        <>
          <Card className="dark:border-gray-800 dark:bg-gray-950">
            <CardContent className="flex items-center gap-4 p-6">
              <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xl font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {initials || <User className="h-7 w-7" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{profile.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Teacher{profile.subject ? ` · ${profile.subject}` : ""}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="dark:border-gray-800 dark:bg-gray-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center gap-3 text-sm">
                <Building2 className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="text-gray-500 dark:text-gray-400">School</span>
                <span className="ml-auto font-medium text-gray-900 dark:text-gray-100">{profile.school.name}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Users className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="text-gray-500 dark:text-gray-400">Mentor Class</span>
                <span className="ml-auto font-medium text-gray-900 dark:text-gray-100">
                  {profile.mentorSection
                    ? `Class ${profile.mentorSection.class.name} – ${profile.mentorSection.name} (${profile.mentorSection.students.length} students)`
                    : "Not assigned"}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
