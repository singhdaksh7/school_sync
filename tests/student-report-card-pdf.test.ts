import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: { reportCard: { findFirst: vi.fn() } } }));
vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null), isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/report-card-pdf", () => ({ generateReportCardPdf: vi.fn(async () => Buffer.from("pdf-bytes")) }));

import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { GET } from "@/app/api/student/report-cards/[id]/pdf/route";

const p = prisma as unknown as { reportCard: { findFirst: ReturnType<typeof vi.fn> } };
const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const featureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const rateMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;
const generatePdfMock = generateReportCardPdf as unknown as ReturnType<typeof vi.fn>;

const STUDENT_AUTH = { studentId: "stu-1", schoolId: "school-a" };
const CARD = {
  id: "card-1",
  schoolId: "school-a",
  studentId: "stu-1",
  status: "PUBLISHED",
  school: { name: "Test School", logoUrl: null, logoFile: null, poweredBySchoolSync: false },
  student: { name: "Aarav", rollNo: "12", section: { name: "A", class: { name: "8" } } },
  examScheme: { name: "Annual" },
  generatedByTeacher: { name: "Mrs. Rao" },
  subjects: [],
  totalMarks: 400,
  percentage: 80,
  grade: "A",
  attendanceSummary: "{}",
  classTeacherRemark: null,
  publishedAt: null,
  templateSnapshot: null,
};

function req() {
  return new Request("http://localhost/api/student/report-cards/card-1/pdf");
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentAuthMock.mockResolvedValue(STUDENT_AUTH);
  featureMock.mockResolvedValue(null);
  rateMock.mockResolvedValue(null);
  generatePdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
  p.reportCard.findFirst.mockResolvedValue(CARD);
});

describe("GET /api/student/report-cards/[id]/pdf", () => {
  it("a student can download their own published report card PDF", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(p.reportCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "card-1", schoolId: "school-a", studentId: "stu-1", status: "PUBLISHED" } })
    );
  });

  it("a report card belonging to a different student is not found", async () => {
    p.reportCard.findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(404);
  });

  it("a DRAFT (unpublished) card is never returned — scoped by status: PUBLISHED in the query itself", async () => {
    await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(p.reportCard.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PUBLISHED" }) }));
  });

  it("unauthenticated request is denied", async () => {
    getStudentAuthMock.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(401);
    expect(p.reportCard.findFirst).not.toHaveBeenCalled();
  });

  it("REPORT_CARDS feature-flag denial is preserved", async () => {
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "Feature unavailable" }, { status: 403 }));
    const res = await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(403);
    expect(p.reportCard.findFirst).not.toHaveBeenCalled();
  });

  it("PDF Cost Guard denial (429) is preserved, keyed by STUDENT actorType", async () => {
    rateMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(req(), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(429);
    expect(rateMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", actorType: "STUDENT", actorId: "stu-1" }), "PDF");
  });
});
