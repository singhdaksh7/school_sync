/**
 * Central school-route Cost Guard helper (Phase 4, PART 5). Generalizes the
 * exact `guard()` pattern already proven in `operations-route-guard.ts`
 * (Phase 2) so the ~170 previously-unwired generic school-admin routes don't
 * each hand-roll their own auth → tenant → Cost Guard preamble.
 *
 * Request flow (unchanged from every prior phase's architecture):
 *   authenticate (auth()) → resolve tenant/actor (canAccessSchool/
 *   canWriteSchool, which also re-check school lifecycle) → Cost Guard
 *   category → business logic.
 *
 * Deliberately NOT a Next.js middleware: middleware runs before route-level
 * auth and cannot reliably resolve the authenticated actor/tenant, which
 * Cost Guard needs to key by (see Cost Guard phase's original architecture
 * note). This stays a plain function called at the top of each route
 * handler, same as every other guard in this codebase.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import type { ApiCostCategory } from "@/lib/cost-guard-policy";

export interface RouteGuardContext {
  userId: string;
  role: string | undefined;
}

export type RouteGuardResult = { ok: true; ctx: RouteGuardContext } | { ok: false; deny: NextResponse };

/**
 * Owner/Admin/VP for reads (`write: false`, the default) or Owner/Admin-only
 * for mutations (`write: true`) — identical semantics to every existing
 * `canAccessSchool`/`canWriteSchool` call site in this codebase, just with
 * the Cost Guard category applied in the same place so it's never forgotten.
 */
export async function guardSchoolRoute(schoolId: string, category: ApiCostCategory, opts: { write?: boolean } = {}): Promise<RouteGuardResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, deny: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const role = sessionRole(session.user);
  const allowed = opts.write ? await canWriteSchool(schoolId, session.user.id, role) : await canAccessSchool(schoolId, session.user.id);
  if (!allowed) {
    return { ok: false, deny: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, category);
  if (denied) return { ok: false, deny: denied };
  return { ok: true, ctx: { userId: session.user.id, role } };
}
