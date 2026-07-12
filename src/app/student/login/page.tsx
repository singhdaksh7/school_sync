import { redirect } from "next/navigation";

// Student login now lives on the unified /login page (single identifier
// field — email routes to the staff provider, admission number routes to
// the student provider; see src/lib/login-identifier.ts). This route is
// kept as a server-side redirect, not removed, so any existing bookmark,
// deep link, or the proxy's/auth.config.ts's public-route allowlist and
// unauthenticated-student redirect target keep working unchanged.
export default function StudentLoginPage() {
  redirect("/login");
}
