"use client";

import { useEffect, useState } from "react";
import GuardianSidebar from "./GuardianSidebar";
import GuardianHeader from "./GuardianHeader";
import { GuardianContext, type GuardianChild } from "./GuardianContext";
import { getGuardianUser, guardianFetch } from "@/lib/guardian-auth-client";
import type { GuardianUser } from "@/lib/guardian-auth-client";

interface ChildrenApiStudent {
  id: string;
  name: string;
  rollNo: string;
  section: { id: string; name: string; class: { id: string; name: string } };
}

export default function GuardianShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<GuardianUser | null>(null);
  const [kids, setKids] = useState<GuardianChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  // Guardian auth is a standalone JWT scheme carried in an httpOnly cookie
  // (see src/lib/parent-auth.ts) — client JS can't read it, so the only way
  // to know whether the session is valid is to ask the server. guardianFetch
  // itself clears the session and redirects to /guardian/login on 401
  // (src/lib/guardian-auth-client.ts), so this is the single auth gate for
  // the whole portal — no separate pre-check needed.
  useEffect(() => {
    setUser(getGuardianUser());
    let active = true;
    guardianFetch("/api/parent/children")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (data) {
          const students: ChildrenApiStudent[] = data.children ?? [];
          setKids(students);
          if (students.length > 0) setSelectedChildId(students[0].id);
        }
        setReady(true);
        setLoading(false);
      })
      .catch(() => { if (active) { setReady(true); setLoading(false); } });
    return () => { active = false; };
  }, []);

  if (!ready) return null;

  return (
    <GuardianContext.Provider
      value={{ user, children: kids, selectedChildId, setSelectedChildId, loading }}
    >
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
          <GuardianSidebar schoolName="SchoolSync" onClose={() => setSidebarOpen(false)} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <GuardianHeader schoolName="SchoolSync" onMenuClick={() => setSidebarOpen((v) => !v)} />
          <main id="top" className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </GuardianContext.Provider>
  );
}
