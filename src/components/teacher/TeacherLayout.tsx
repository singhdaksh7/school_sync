"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import TeacherSidebar from "./TeacherSidebar";
import TeacherHeader from "./TeacherHeader";

interface TeacherProfile {
  name?: string;
  school?: { name?: string };
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop collapse
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const pathname = usePathname();

  // Load teacher identity for the header/sidebar (read-only; no business logic)
  useEffect(() => {
    let active = true;
    fetch("/api/teacher/me")
      .then((r) => r.json())
      .then((d) => { if (active && !d.error) setProfile(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Auto-close mobile drawer after navigation
  useEffect(() => {
    const id = window.setTimeout(() => setSidebarOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  // Close mobile drawer on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const schoolName = profile?.school?.name;
  const teacherName = profile?.name;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: drawer on mobile, static on md+ */}
      <div
        className={[
          "fixed inset-y-0 left-0 z-40 transition-transform duration-300 md:static md:z-auto md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <TeacherSidebar
          schoolName={schoolName}
          collapsed={collapsed}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TeacherHeader
          schoolName={schoolName}
          teacherName={teacherName}
          onMenuClick={() => setSidebarOpen((v) => !v)}
          onCollapseToggle={() => setCollapsed((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
