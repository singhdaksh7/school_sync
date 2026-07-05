/**
 * School Operations Command Center — today activity timeline (PART 19).
 * Normalized from the existing `AuditLog` table — no new event/log model.
 * Excludes noise actions (auth/session/invite/subscription events) per the
 * baseline audit's noise-vs-business-event classification, so the timeline
 * reads as "what happened operationally at this school today", not a raw
 * security/auth log dump.
 */

import { prisma } from "@/lib/prisma";
import type { AuditAction } from "@/lib/audit";

export const ACTIVITY_NOISE_ACTIONS: readonly AuditAction[] = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "INVITE_CREATED",
  "INVITE_RESENT",
  "INVITE_CANCELLED",
  "INVITE_ACCEPTED",
  "FOUNDER_INVITE_CREATED",
  "FOUNDER_INVITE_RESENT",
  "FOUNDER_INVITE_CANCELLED",
  "SUBSCRIPTION_UPDATED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
];

export interface ActivityItem {
  id: string;
  code: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface ActivityTimelinePage {
  data: ActivityItem[];
  total: number;
}

export const DEFAULT_ACTIVITY_LIMIT = 20;

function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}

export async function loadTodayActivityTimeline(
  schoolId: string,
  dateOnly: Date,
  opts: { skip?: number; take?: number } = {}
): Promise<ActivityTimelinePage> {
  const tomorrow = nextDay(dateOnly);
  const skip = opts.skip ?? 0;
  const take = opts.take ?? DEFAULT_ACTIVITY_LIMIT;

  const where = {
    schoolId,
    createdAt: { gte: dateOnly, lt: tomorrow },
    action: { notIn: [...ACTIVITY_NOISE_ACTIONS] },
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, action: true, entityType: true, entityId: true, metadata: true, actorRole: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data: ActivityItem[] = rows.map((r) => ({
    id: r.id,
    code: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorName: r.user?.name ?? null,
    actorRole: r.actorRole,
    createdAt: r.createdAt,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
  }));

  return { data, total };
}
