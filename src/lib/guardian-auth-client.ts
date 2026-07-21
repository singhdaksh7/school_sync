"use client";

/**
 * Client-side session management for the Guardian/Parent web portal.
 *
 * Guardian auth is NOT the NextAuth auth()/sessionRole() pattern used by
 * every other portal in this app — /api/parent/login issues a signed JWT
 * (see src/lib/parent-auth.ts: generateParentToken/getAuthenticatedGuardian).
 * The web portal (this module) carries that JWT as an httpOnly, Secure,
 * SameSite=Lax cookie set server-side on login — never in localStorage or a
 * client-readable header — so it's immune to XSS token theft. This app's
 * real mobile client is a separate consumer of the exact same
 * /api/parent/login response and keeps using `Authorization: Bearer
 * <token>` instead (a frozen external contract — see
 * docs/backend-pilot-contract-freeze.md); getAuthenticatedGuardian() on the
 * server accepts either.
 */

const USER_KEY = "schoolsync.guardianUser";
const GUARDIAN_LOGIN_PATH = "/guardian/login";

export interface GuardianUser {
  id: string;
  name: string;
  email?: string | null;
  phone: string;
  role: string;
  schoolId: string;
  schoolSlug: string;
}

/** Persists only the (non-sensitive) profile for optimistic display — never the token, which lives solely in the httpOnly cookie. */
export function saveGuardianSession(user: GuardianUser) {
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getGuardianUser(): GuardianUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuardianUser;
  } catch {
    return null;
  }
}

export function clearGuardianSession() {
  window.localStorage.removeItem(USER_KEY);
}

/**
 * Clears the session (cached profile + the httpOnly cookie, via the server
 * logout route) and sends the user back to login. Used both for an explicit
 * user-initiated logout and for the automatic 401 handling in
 * guardianFetch() below — one code path, one behavior, everywhere.
 */
export async function guardianLogout(): Promise<void> {
  clearGuardianSession();
  try {
    await fetch("/api/parent/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort — the cookie may already be gone/expired; redirect regardless.
  }
  if (typeof window !== "undefined") window.location.href = GUARDIAN_LOGIN_PATH;
}

/**
 * Fetch wrapper for every /api/parent/* call. Sends the httpOnly session
 * cookie automatically (same-origin fetch default), and centralizes 401
 * handling: any /api/parent/* call that comes back unauthenticated clears
 * the session and redirects to login, uniformly, instead of each caller
 * deciding for itself.
 */
export async function guardianFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: "include" });
  if (res.status === 401) {
    void guardianLogout();
  }
  return res;
}
