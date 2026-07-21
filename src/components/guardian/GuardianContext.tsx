"use client";

import { createContext, useContext } from "react";
import type { GuardianUser } from "@/lib/guardian-auth-client";

export interface GuardianChild {
  id: string;
  name: string;
  rollNo: string;
  section: { id: string; name: string; class: { id: string; name: string } };
}

export interface GuardianContextValue {
  user: GuardianUser | null;
  children: GuardianChild[];
  selectedChildId: string | null;
  setSelectedChildId: (id: string) => void;
  loading: boolean;
}

export const GuardianContext = createContext<GuardianContextValue | null>(null);

export function useGuardianContext(): GuardianContextValue {
  const ctx = useContext(GuardianContext);
  if (!ctx) throw new Error("useGuardianContext must be used within GuardianShell");
  return ctx;
}
