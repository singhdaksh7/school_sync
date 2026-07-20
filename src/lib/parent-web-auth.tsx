"use client";

/**
 * Minimal parent web-portal auth. The parent APIs (/api/parent/*) are
 * bearer-JWT only — the same mechanism the mobile app conventions already
 * use (see src/lib/parent-auth.ts / getAuthenticatedGuardian) — so this
 * client keeps that exact same token in localStorage and attaches it as an
 * `Authorization: Bearer` header on every parent API call, rather than
 * inventing a new session/cookie scheme. No API route or auth convention
 * changes for this — only a new, self-contained client.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "schoolsync_parent_auth";

export interface ParentUser {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: "PARENT";
  schoolId: string;
  schoolSlug: string;
}

interface StoredParentAuth {
  token: string;
  user: ParentUser;
}

function readStoredAuth(): StoredParentAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredParentAuth;
  } catch {
    return null;
  }
}

interface ParentAuthContextValue {
  token: string | null;
  user: ParentUser | null;
  ready: boolean;
  login: (auth: StoredParentAuth) => void;
  logout: () => void;
}

const ParentAuthContext = createContext<ParentAuthContextValue | null>(null);

export function ParentAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredParentAuth | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setAuth(readStoredAuth());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const login = useCallback((next: StoredParentAuth) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setAuth(null);
  }, []);

  const value = useMemo<ParentAuthContextValue>(
    () => ({ token: auth?.token ?? null, user: auth?.user ?? null, ready, login, logout }),
    [auth, ready, login, logout]
  );

  return <ParentAuthContext.Provider value={value}>{children}</ParentAuthContext.Provider>;
}

export function useParentAuth() {
  const ctx = useContext(ParentAuthContext);
  if (!ctx) throw new Error("useParentAuth must be used within ParentAuthProvider");
  return ctx;
}

/** Redirects to /parent/login once auth has finished loading and there is no token. */
export function useRequireParentAuth() {
  const { token, ready } = useParentAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !token) router.replace("/parent/login");
  }, [ready, token, router]);
  return { token, ready };
}

/** fetch() wrapper that attaches the stored parent bearer token — use for every /api/parent/* call. */
export function useParentFetch() {
  const { token } = useParentAuth();
  return useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetch(input, { ...init, headers });
    },
    [token]
  );
}
