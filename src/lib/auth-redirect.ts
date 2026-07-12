/**
 * Pure role → destination mapping, extracted from
 * src/app/api/auth/redirect/route.ts so the redirect rule for every role can
 * be unit tested directly. The route handler is a thin wrapper that reads
 * the server session and calls this function — the client never supplies
 * (or influences) the role or destination.
 */
export type RedirectSessionUser = {
  role?: string | null;
  schoolSlug?: string | null;
};

export function resolveRedirectPath(user: RedirectSessionUser | null | undefined): string {
  if (!user) return "/login";
  if (user.role === "FOUNDER") return "/founder/dashboard";
  if (user.role === "STUDENT") return "/student/dashboard";
  if (user.role === "TEACHER") return "/teacher/attendance";
  if (user.schoolSlug) return `/dashboard/${user.schoolSlug}`;
  return "/no-school";
}
