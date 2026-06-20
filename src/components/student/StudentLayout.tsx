"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import StudentSidebar from "./StudentSidebar";
import StudentHeader from "./StudentHeader";

interface StudentProfile {
  name?: string;
  school?: { name?: string };
}

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    fetch("/api/student/profile")
      .then((r) => r.json())
      .then((d) => { if (active && !d.error) setProfile(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSidebarOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const schoolName = profile?.school?.name;
  const studentName = profile?.name;

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30 text-foreground">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={[
          "fixed inset-y-0 left-0 z-40 transition-transform duration-300 md:static md:z-auto md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <StudentSidebar
          schoolName={schoolName}
          collapsed={collapsed}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <StudentHeader
          schoolName={schoolName}
          studentName={studentName}
          onMenuClick={() => setSidebarOpen((v) => !v)}
          onCollapseToggle={() => setCollapsed((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
