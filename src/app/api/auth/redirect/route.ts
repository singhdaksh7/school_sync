import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreRedirect(path: string) {
  return new Response(null, {
    status: 307,
    headers: {
      Location: path,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return noStoreRedirect("/login");

  const user = session.user as { role?: string; schoolSlug?: string };
  if (user.role === "TEACHER") return noStoreRedirect("/teacher/attendance");

  if (user.schoolSlug) return noStoreRedirect(`/dashboard/${user.schoolSlug}`);
  return noStoreRedirect("/onboarding");
}
