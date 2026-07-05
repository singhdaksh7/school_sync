import type { Metadata } from "next";
import { headers } from "next/headers";
import { hostnameFromHeaders, resolveTenantAppName } from "@/lib/school-resolver";

// Metadata-only wrapper — /login/page.tsx is a client component, and
// generateMetadata only works from a server component (layout or page).
// Purely a <title> resolution; renders no markup of its own.
export async function generateMetadata(): Promise<Metadata> {
  const hdrs = await headers();
  const appName = await resolveTenantAppName(hostnameFromHeaders(hdrs));
  return { title: `Sign In | ${appName ?? "SchoolSync"}` };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
