import { describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the Draft Workspace "teacher assignment disappears"
 * bug: SmartTimetableWorkspace.refreshDraftDetails() calls
 * GET /drafts/[draftId], whose route wraps the draft as `{ draft }` (same
 * contract as POST /drafts). getDraft() must (a) return slots with a
 * populated `teacher` relation so the UI never has to fall back to a stale
 * client-side teacher list, and (b) the route's response envelope must stay
 * `{ draft }` so `data.draft` unwrapping on the client matches reality.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    timetableDraft: { findFirst: vi.fn(async () => ({ id: "draft-1", slots: [] })) },
  },
}));

import { prisma } from "@/lib/prisma";
import { getDraft } from "@/lib/smart-timetable-drafts";

describe("getDraft — slot teacher relation", () => {
  it("includes the teacher relation (id, name) on each slot so assigned teachers resolve from the draft response itself", async () => {
    await getDraft("draft-1", "school-1");
    const findFirstMock = (prisma as unknown as { timetableDraft: { findFirst: ReturnType<typeof vi.fn> } }).timetableDraft.findFirst;
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "draft-1", schoolId: "school-1" },
      include: {
        slots: {
          orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
          include: { teacher: { select: { id: true, name: true } } },
        },
      },
    });
  });
});
