import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  listNotificationsForRecipient,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notification-queries";

const p = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.resetAllMocks();
});

const STUDENT = { recipientType: "STUDENT" as const, recipientId: "st1" };

function row(id: string, createdAt: string) {
  return { id, eventType: "HOMEWORK_PUBLISHED" as const, entityType: "Homework", entityId: "hw1", metadata: null, createdAt: new Date(createdAt), readAt: null, archivedAt: null };
}

describe("listNotificationsForRecipient — scoping + cursor pagination", () => {
  it("scopes the query by schoolId + recipientType + the recipient's own FK column", async () => {
    p.notification.findMany.mockResolvedValue([]);
    await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT });
    const query = p.notification.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ schoolId: "school-a", recipientType: "STUDENT", studentId: "st1", archivedAt: null });
  });

  it("never lets a client-influenced parameter widen the recipient scope", async () => {
    p.notification.findMany.mockResolvedValue([]);
    await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT, unreadOnly: true });
    const query = p.notification.findMany.mock.calls[0][0];
    expect(query.where.readAt).toBeNull();
    expect(query.where.studentId).toBe("st1");
  });

  it("returns a nextCursor only when more rows exist beyond the page limit, and it decodes back to the same (createdAt,id)", async () => {
    const rows = [row("n3", "2026-01-03"), row("n2", "2026-01-02")];
    p.notification.findMany.mockResolvedValueOnce([...rows, row("n1", "2026-01-01")]); // limit+1 sentinel
    const page1 = await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT, limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["n3", "n2"]);
    expect(page1.nextCursor).toBeTruthy();

    p.notification.findMany.mockResolvedValueOnce([row("n1", "2026-01-01")]);
    const page2 = await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT, limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.id)).toEqual(["n1"]);
    expect(page2.nextCursor).toBeNull();

    const cursorWhere = p.notification.findMany.mock.calls[1][0].where;
    expect(cursorWhere.OR).toBeDefined();
  });

  it("a malformed cursor yields a safe empty page, never an error", async () => {
    const result = await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT, cursor: "not-a-real-cursor!!" });
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(p.notification.findMany).not.toHaveBeenCalled();
  });

  it("clamps the ordering to a stable (createdAt desc, id desc) tiebreak", async () => {
    p.notification.findMany.mockResolvedValue([]);
    await listNotificationsForRecipient({ schoolId: "school-a", recipient: STUDENT });
    const query = p.notification.findMany.mock.calls[0][0];
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("unreadNotificationCount", () => {
  it("counts only unread, non-archived rows scoped to the recipient", async () => {
    p.notification.count.mockResolvedValue(3);
    const count = await unreadNotificationCount("school-a", STUDENT);
    expect(count).toBe(3);
    expect(p.notification.count).toHaveBeenCalledWith({ where: { schoolId: "school-a", recipientType: "STUDENT", studentId: "st1", archivedAt: null, readAt: null } });
  });
});

describe("markNotificationRead — recipient-scoped, idempotent, non-enumerating", () => {
  it("marks read when the update matches (correct recipient/tenant)", async () => {
    p.notification.updateMany.mockResolvedValue({ count: 1 });
    const result = await markNotificationRead("school-a", STUDENT, "n1");
    expect(result).toEqual({ ok: true });
    expect(p.notification.updateMany.mock.calls[0][0].where).toMatchObject({ id: "n1", schoolId: "school-a", studentId: "st1", readAt: null });
  });

  it("is idempotent — marking an already-read notification again returns ok:true, not an error", async () => {
    p.notification.updateMany.mockResolvedValue({ count: 0 }); // already readAt != null, so the guarded update matched nothing
    p.notification.findFirst.mockResolvedValue({ id: "n1" }); // but it still exists in-scope
    const result = await markNotificationRead("school-a", STUDENT, "n1");
    expect(result).toEqual({ ok: true });
  });

  it("returns NOT_FOUND (never distinguishing 'exists but not yours' from 'doesn't exist') for a foreign/cross-tenant id", async () => {
    p.notification.updateMany.mockResolvedValue({ count: 0 });
    p.notification.findFirst.mockResolvedValue(null);
    const result = await markNotificationRead("school-a", STUDENT, "someone-elses-notification");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("the re-check uses the SAME scope as the update, never a looser one", async () => {
    p.notification.updateMany.mockResolvedValue({ count: 0 });
    p.notification.findFirst.mockResolvedValue(null);
    await markNotificationRead("school-a", STUDENT, "n1");
    expect(p.notification.findFirst.mock.calls[0][0].where).toMatchObject({ id: "n1", schoolId: "school-a", studentId: "st1" });
  });
});

describe("markAllNotificationsRead", () => {
  it("updates only this recipient's currently-unread rows and reports the count", async () => {
    p.notification.updateMany.mockResolvedValue({ count: 5 });
    const result = await markAllNotificationsRead("school-a", STUDENT);
    expect(result).toEqual({ count: 5 });
    expect(p.notification.updateMany).toHaveBeenCalledWith({
      where: { schoolId: "school-a", recipientType: "STUDENT", studentId: "st1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
