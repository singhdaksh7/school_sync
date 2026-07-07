/**
 * Teacher Operations Command Center mobile bearer-compatibility (Phase 6
 * mega-phase). Every `/api/schools/[schoolId]/operations/*` capability route
 * and the leave-management routes resolved identity via a NextAuth web
 * session only (`auth()`). This composes that SAME resolution with the
 * existing bearer mobile Teacher path (`getMobileAuth`) —
 * authentication-transport only. `canAccessSchool`/`canWriteSchool`/
 * `canManageTeacherOperations`/`requireSchoolAccess` are all called exactly
 * as before by every route, with whatever `{userId, role}` this resolves to.
 *
 * Deliberately Teacher-only on the bearer path: Owner/Admin/VP mobile access
 * to the Operations Command Center is out of Phase 6 scope (mobile Admin
 * remains a stub) — those roles continue to authenticate via the NextAuth
 * path only, exactly as before.
 */
import { auth } from "@/lib/auth";
import { getMobileAuth } from "@/lib/mobile-auth";
import { sessionRole } from "@/lib/tenant";

export interface OperationsActorIdentity {
  userId: string;
  role: string | undefined;
}

export async function resolveOperationsActor(req: Request): Promise<OperationsActorIdentity | null> {
  const mobile = await getMobileAuth(req);
  if (mobile?.decoded.role === "TEACHER" && "teacher" in mobile && mobile.teacher && mobile.decoded.userId) {
    return { userId: mobile.decoded.userId, role: "TEACHER" };
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  return { userId: session.user.id, role: sessionRole(session.user) };
}
