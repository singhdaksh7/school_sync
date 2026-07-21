// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SmartTimetableWorkspace from "@/components/timetable/SmartTimetableWorkspace";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";

/**
 * Client-side regression coverage for the Draft Workspace teacher-assignment
 * bug: refreshDraftDetails() previously stored the raw GET /drafts/[id]
 * response envelope (`{ draft }`) into `selectedDraft` instead of unwrapping
 * it, so `selectedDraft.slots` was always undefined and every grid cell
 * rendered empty regardless of what was actually persisted (see
 * SmartTimetableWorkspace.tsx refreshDraftDetails / renderSlotCell).
 *
 * These tests render the real component against a mocked `fetch` that
 * returns the real `{ draft }` envelope shape, and drive the same
 * class -> section -> Drafts Workspace -> draft selection path a user
 * takes, to prove the fix holds end-to-end through the DOM.
 */

const SCHOOL_ID = "school-1";
const CLASS_ID = "class-1";
const SECTION_ID = "section-1";
const DRAFT_ID = "draft-1";

const TEACHERS = [
  { id: "teacher-1", name: "Asha Verma", subject: "Mathematics" },
  { id: "teacher-2", name: "Ravi Kumar", subject: "Mathematics" },
];

const CLASSES = [{ id: CLASS_ID, name: "Class 6", sections: [{ id: SECTION_ID, name: "A" }] }];

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
  } as Response);
}

interface SlotFixture {
  id: string;
  dayOfWeek: number;
  period: number;
  subjectName: string | null;
  teacherId: string | null;
  teacher: { id: string; name: string } | null;
  locked: boolean;
}

/** Simulates the server: GET reflects whatever the last POST persisted. */
function makeBackend(initialSlots: SlotFixture[], draftStatus: "DRAFT" | "VALID" | "INVALID" = "DRAFT") {
  let slots = initialSlots;
  let status = draftStatus;

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    if (url.includes("/smart-timetable/requirements?sectionId=")) {
      return jsonResponse({
        requirements: [
          {
            id: "req-1",
            subjectId: "subj-math",
            subjectName: "Mathematics",
            requiredPeriodsPerWeek: 5,
            minPeriodsPerDay: null,
            maxPeriodsPerDay: null,
            allowConsecutive: false,
            preferredTeacherId: null,
          },
        ],
        capacity: { totalCapacity: 40, requiredPeriods: 5, isValid: true },
      });
    }
    if (url.includes("/subjects?classId=")) {
      return jsonResponse([{ id: "subj-math", name: "Mathematics" }]);
    }
    if (/\/smart-timetable\/drafts\?sectionId=/.test(url)) {
      return jsonResponse({ data: [{ id: DRAFT_ID, status, createdAt: new Date().toISOString() }] });
    }
    if (url.endsWith(`/drafts/${DRAFT_ID}`) && method === "GET") {
      return jsonResponse({
        draft: { id: DRAFT_ID, status, createdAt: new Date().toISOString(), slots },
      });
    }
    if (url.endsWith(`/drafts/${DRAFT_ID}/quality`)) {
      return jsonResponse({ score: 80 });
    }
    if (url.endsWith(`/drafts/${DRAFT_ID}/validate`)) {
      return jsonResponse({ issues: [] });
    }
    if (url.includes("/teacher-recommendations")) {
      return jsonResponse({
        recommendations: TEACHERS.map((t, i) => ({
          teacherId: t.id,
          teacherName: t.name,
          score: 90 - i,
          label: "PERFECT",
          workload: { current: 2, maximum: 20, remaining: 18 },
          reasons: [],
          warnings: [],
        })),
      });
    }
    if (url.endsWith(`/drafts/${DRAFT_ID}/slots`) && method === "POST") {
      const body = JSON.parse(init!.body as string) as { dayOfWeek: number; period: number; subjectName: string | null; teacherId: string | null };
      const teacher = body.teacherId ? TEACHERS.find((t) => t.id === body.teacherId) ?? null : null;
      const idx = slots.findIndex((s) => s.dayOfWeek === body.dayOfWeek && s.period === body.period);
      const updated: SlotFixture = {
        id: idx >= 0 ? slots[idx].id : "slot-new",
        dayOfWeek: body.dayOfWeek,
        period: body.period,
        subjectName: body.subjectName,
        teacherId: body.teacherId,
        teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
        locked: false,
      };
      slots = idx >= 0 ? slots.map((s, i) => (i === idx ? updated : s)) : [...slots, updated];
      return jsonResponse({ slot: { id: updated.id, dayOfWeek: updated.dayOfWeek, period: updated.period, subjectName: updated.subjectName, teacherId: updated.teacherId, locked: updated.locked } });
    }

    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });

  return {
    fetchMock,
    setStatus: (next: typeof status) => {
      status = next;
    },
  };
}

function renderWorkspace(locale: "en" | "hi" = "en") {
  return render(
    <LanguageProvider initialLocale={locale}>
      <SmartTimetableWorkspace schoolId={SCHOOL_ID} initialClasses={CLASSES} initialTeachers={TEACHERS} schoolSlug="demo-school" />
    </LanguageProvider>
  );
}

async function selectClassAndSectionThenOpenDraft() {
  const classTrigger = screen.getByText("Select a class").closest("button")!;
  fireEvent.pointerDown(classTrigger, { button: 0, pointerId: 1, isPrimary: true });
  const classOption = await screen.findByText("Class 6");
  fireEvent.click(classOption);

  const sectionTrigger = await screen.findByText("Select a section").then((el) => el.closest("button")!);
  fireEvent.pointerDown(sectionTrigger, { button: 0, pointerId: 1, isPrimary: true });
  const sectionOption = await screen.findByText("A");
  fireEvent.click(sectionOption);

  fireEvent.click(await screen.findByText(/Drafts Workspace/));
  fireEvent.click(await screen.findByText(/Draft #1/));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SmartTimetableWorkspace — Draft Workspace teacher-assignment rendering", () => {
  it("root cause regression: an assigned slot renders the teacher's name, an Assigned badge, correct counts, a real draft status, and enables Publish only when VALID", async () => {
    const backend = makeBackend(
      [
        {
          id: "slot-1",
          dayOfWeek: 1,
          period: 1,
          subjectName: "Mathematics",
          teacherId: "teacher-1",
          teacher: { id: "teacher-1", name: "Asha Verma" },
          locked: false,
        },
      ],
      "VALID"
    );
    vi.stubGlobal("fetch", backend.fetchMock);

    renderWorkspace();
    await selectClassAndSectionThenOpenDraft();

    expect(await screen.findByText("Asha Verma")).toBeTruthy();
    expect(screen.getByText("Assigned")).toBeTruthy();
    expect(screen.queryByText("No teacher assigned")).toBeNull();

    // Teacher Assignment counter: 1 assigned, 0 unassigned.
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/0 unassigned/)).toBeTruthy();

    // selectedDraft.status flowed through correctly -> "Ready to Publish" and
    // an enabled Publish button (previously: status was always undefined,
    // so this never showed VALID and Publish stayed permanently disabled).
    expect(await screen.findByText("Ready to Publish")).toBeTruthy();
    const publishButton = screen.getByRole("button", { name: /Publish Timetable/ });
    expect(publishButton).not.toHaveProperty("disabled", true);
  });

  it("an unassigned slot renders no teacher name and an Unassigned badge", async () => {
    const backend = makeBackend([
      {
        id: "slot-1",
        dayOfWeek: 1,
        period: 1,
        subjectName: "Mathematics",
        teacherId: null,
        teacher: null,
        locked: false,
      },
    ]);
    vi.stubGlobal("fetch", backend.fetchMock);

    renderWorkspace();
    await selectClassAndSectionThenOpenDraft();

    expect(await screen.findByText("No teacher assigned")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByText("Asha Verma")).toBeNull();

    // Draft is still DRAFT (not validated) -> Publish disabled, Issues Found shown.
    expect(await screen.findByText("Issues Found")).toBeTruthy();
    const publishButton = screen.getByRole("button", { name: /Publish Timetable/ });
    expect(publishButton).toHaveProperty("disabled", true);
  });

  it("assigning a teacher then refreshing shows the teacher name and Assigned badge, and updates counts", async () => {
    const backend = makeBackend([
      {
        id: "slot-1",
        dayOfWeek: 1,
        period: 1,
        subjectName: "Mathematics",
        teacherId: null,
        teacher: null,
        locked: false,
      },
    ]);
    vi.stubGlobal("fetch", backend.fetchMock);

    renderWorkspace();
    await selectClassAndSectionThenOpenDraft();

    expect(await screen.findByText("No teacher assigned")).toBeTruthy();

    // Open the slot editor for the unassigned cell.
    fireEvent.click(screen.getByText("Mathematics"));
    const recommendation = await screen.findByText("Asha Verma");
    fireEvent.click(recommendation);

    // POST persisted -> refreshDraftDetails() re-fetches -> UI reflects the
    // assignment without a page reload.
    await waitFor(() => expect(screen.getByText("Assigned")).toBeTruthy());
    expect(screen.queryByText("No teacher assigned")).toBeNull();
    expect(screen.getByText(/0 unassigned/)).toBeTruthy();
  });

  it("changing a teacher, then removing the assignment, both survive a refresh", async () => {
    const backend = makeBackend([
      {
        id: "slot-1",
        dayOfWeek: 1,
        period: 1,
        subjectName: "Mathematics",
        teacherId: "teacher-1",
        teacher: { id: "teacher-1", name: "Asha Verma" },
        locked: false,
      },
    ]);
    vi.stubGlobal("fetch", backend.fetchMock);

    renderWorkspace();
    await selectClassAndSectionThenOpenDraft();
    expect(await screen.findByText("Asha Verma")).toBeTruthy();

    // Change teacher: Asha Verma -> Ravi Kumar.
    fireEvent.click(screen.getByText("Mathematics"));
    const otherTeacher = await screen.findByText("Ravi Kumar");
    fireEvent.click(otherTeacher);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
    expect(screen.queryByText("Asha Verma")).toBeNull();
    expect(screen.getByText("Assigned")).toBeTruthy();

    // Remove the assignment entirely via "Clear Assignment".
    fireEvent.click(screen.getByText("Mathematics"));
    const clearButton = await screen.findByRole("button", { name: /Clear Assignment/ });
    fireEvent.click(clearButton);

    await waitFor(() => expect(screen.getByText("No teacher assigned")).toBeTruthy());
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByText("Ravi Kumar")).toBeNull();
    expect(screen.getByText(/1 unassigned/)).toBeTruthy();
  });

  it("Assigned/Unassigned/no-teacher labels come from the Hindi locale file, not hard-coded English text", async () => {
    const backend = makeBackend([
      {
        id: "slot-1",
        dayOfWeek: 1,
        period: 1,
        subjectName: "Mathematics",
        teacherId: null,
        teacher: null,
        locked: false,
      },
    ]);
    vi.stubGlobal("fetch", backend.fetchMock);

    renderWorkspace("hi");
    await selectClassAndSectionThenOpenDraft();

    expect(await screen.findByText("कोई शिक्षक असाइन नहीं")).toBeTruthy();
    expect(screen.getByText("असाइन नहीं")).toBeTruthy();
    expect(screen.queryByText("No teacher assigned")).toBeNull();
    expect(screen.queryByText("Unassigned")).toBeNull();
  });
});
