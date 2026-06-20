"use client";

import { useEffect, useState, useCallback } from "react";

type PermissionPair = { module: string; action: string };
type TeacherScope = { classIds: string[]; sectionIds: string[]; unrestricted: boolean };

export function useTeacherPermissions() {
  const [permissions, setPermissions] = useState<PermissionPair[]>([]);
  const [scope, setScope] = useState<TeacherScope>({ classIds: [], sectionIds: [], unrestricted: true });
  const [loading, setLoading] = useState(true);
  // No TeacherRoleAssignment at all -> legacy unrestricted access (mirrors
  // authorizeTeacher's default-open behavior). Once a custom role is
  // assigned, access narrows to exactly what's granted.
  const [hasCustomRole, setHasCustomRole] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/teacher/permissions", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { permissions: PermissionPair[]; scope: TeacherScope; hasCustomRole: boolean } | null) => {
        if (!active || !data) return;
        setPermissions(data.permissions);
        setScope(data.scope);
        setHasCustomRole(data.hasCustomRole);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const has = useCallback(
    (module: string, action: string) => {
      if (!hasCustomRole) return true;
      return permissions.some((p) => p.module === module && p.action === action);
    },
    [permissions, hasCustomRole]
  );

  return { permissions, scope, loading, has };
}
