import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { renderTextPdf, wrapText, countPdfPages } from "@/lib/pdf-lite";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { generateReceiptPdf } from "@/lib/receipt-pdf";
import { MemoryStorageProvider, setStorageProvider } from "@/lib/storage";
import type { TemplateSnapshot } from "@/lib/report-card-templates";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function isValidPdf(buf: Buffer): boolean {
  const s = buf.toString("latin1");
  return s.startsWith("%PDF-") && s.includes("%%EOF") && /\/Type\s*\/Catalog/.test(s);
}

/**
 * pdf-lib content streams are FlateDecode-compressed and text is drawn as hex
 * strings (`<...>`), not literal `(...)` strings — inflate every stream and
 * hex-decode every `<...>` token so rendered text can be substring-matched.
 */
function decodedText(buf: Buffer): string {
  const s = buf.toString("latin1");
  let out = "";
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(s))) {
    let chunk: string;
    try {
      chunk = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      chunk = m[1];
    }
    out += chunk.replace(/<([0-9A-Fa-f]+)>/g, (_all, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
    out += "\n";
  }
  return out;
}

describe("pdf-lite layout engine", () => {
  it("paginates long content onto multiple pages (no clipping)", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `Line ${i} of report content`, size: 10 }));
    const pdf = renderTextPdf(lines);
    expect(isValidPdf(pdf)).toBe(true);
    expect(countPdfPages(pdf)).toBeGreaterThan(1);
  });

  it("wraps long unbroken and long word text within a line width", () => {
    const wrapped = wrapText("a".repeat(300), 40);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.every((l) => l.length <= 40)).toBe(true);

    const sentence = wrapText("The quick brown fox jumps over the lazy dog repeatedly and often", 20);
    expect(sentence.every((l) => l.length <= 20)).toBe(true);
  });

  it("single short document remains one page", () => {
    const pdf = renderTextPdf([{ text: "Hello", size: 12 }]);
    expect(countPdfPages(pdf)).toBe(1);
  });
});

const baseReportCard = {
  schoolName: "Springfield Public School",
  studentName: "Lakshmi Venkatanarasimha Rajarajeshwari Subramaniam",
  rollNo: "42",
  classSection: "10 - A",
  examName: "Annual Examination 2026",
  rank: 3,
  totalMarks: 850,
  percentage: 85,
  grade: "A",
  attendance: { totalDays: 200, presentDays: 190, absentDays: 8, lateDays: 2, percentage: 95 },
  classTeacherRemark: "Consistent and diligent throughout the year.",
  generatedBy: "Class Teacher",
  publishedAt: "2026-03-31",
};

describe("report card PDF renderer", () => {
  it("renders many subjects across multiple pages without clipping", async () => {
    const subjects = Array.from({ length: 60 }, (_, i) => ({
      subject: `Subject Number ${i} With A Fairly Long Descriptive Name`,
      marks: 80 + (i % 20),
      maxMarks: 100,
      grade: "A",
      subjectTeacherRemark: "Good performance and steady improvement noted this term.",
    }));
    const pdf = await generateReportCardPdf({ ...baseReportCard, subjects });
    expect(isValidPdf(pdf)).toBe(true);
    expect(countPdfPages(pdf)).toBeGreaterThan(1);
    expect(decodedText(pdf)).toContain("Springfield Public School");
  });

  it("handles a minimal report card (few subjects) on a single page", async () => {
    const pdf = await generateReportCardPdf({
      ...baseReportCard,
      subjects: [{ subject: "Maths", marks: 90, maxMarks: 100, grade: "A+" }],
    });
    expect(isValidPdf(pdf)).toBe(true);
    expect(countPdfPages(pdf)).toBe(1);
  });

  it("embeds managed logo/stamp/signature images and honors template colours/watermark/footer", async () => {
    const provider = new MemoryStorageProvider();
    setStorageProvider(provider);
    try {
      await provider.putObject({ key: "logo.png", body: ONE_PIXEL_PNG, contentType: "image/png", visibility: "TENANT_PRIVATE" });
      await provider.putObject({ key: "stamp.png", body: ONE_PIXEL_PNG, contentType: "image/png", visibility: "TENANT_PRIVATE" });
      await provider.putObject({ key: "sig.png", body: ONE_PIXEL_PNG, contentType: "image/png", visibility: "TENANT_PRIVATE" });

      const template: TemplateSnapshot = {
        templateName: "Modern",
        layoutType: "MODERN",
        paperSize: "A4_PORTRAIT",
        logoUrl: null,
        logoAsset: { storageKey: "logo.png", contentType: "image/png" },
        principalSignatureUrl: null,
        signatureAsset: { storageKey: "sig.png", contentType: "image/png" },
        classTeacherSignatureEnabled: true,
        stampUrl: null,
        stampAsset: { storageKey: "stamp.png", contentType: "image/png" },
        watermarkText: "SPECIMEN",
        backgroundImageUrl: null,
        footerText: "Issued by Springfield Public School",
        primaryColor: "#123456",
        secondaryColor: "#654321",
        showAttendance: true,
        showRank: true,
        showGrade: true,
        showRemarks: true,
        showSubjectTeacherRemarks: true,
        showClassTeacherRemarks: true,
        showCoCurricular: false,
        showSkills: false,
        showDiscipline: false,
        showAwards: false,
        showCustomFields: false,
        gradeBands: [{ label: "A+", min: 90, max: 100 }],
        subjectGroups: [],
        customSections: [],
      };

      const pdf = await generateReportCardPdf({
        ...baseReportCard,
        subjects: [{ subject: "Maths", marks: 95, maxMarks: 100, grade: "A+", subjectTeacherRemark: "Excellent" }],
        template,
      });
      expect(isValidPdf(pdf)).toBe(true);
      // Three embedded PNG image XObjects: logo, stamp, signature.
      expect((pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBe(3);
      const text = decodedText(pdf);
      expect(text).toContain("SPECIMEN");
      expect(text).toContain("Issued by Springfield Public School");
    } finally {
      setStorageProvider(null);
    }
  });

  it("skips an unembeddable asset format (WEBP) without failing the document", async () => {
    const provider = new MemoryStorageProvider();
    setStorageProvider(provider);
    try {
      const template: TemplateSnapshot = {
        templateName: "Classic",
        layoutType: "CLASSIC",
        paperSize: "A4_PORTRAIT",
        logoUrl: null,
        logoAsset: { storageKey: "missing-or-unsupported.webp", contentType: "image/webp" },
        principalSignatureUrl: null,
        signatureAsset: null,
        classTeacherSignatureEnabled: true,
        stampUrl: null,
        stampAsset: null,
        watermarkText: null,
        backgroundImageUrl: null,
        footerText: null,
        primaryColor: null,
        secondaryColor: null,
        showAttendance: true,
        showRank: false,
        showGrade: true,
        showRemarks: true,
        showSubjectTeacherRemarks: false,
        showClassTeacherRemarks: true,
        showCoCurricular: false,
        showSkills: false,
        showDiscipline: false,
        showAwards: false,
        showCustomFields: false,
        gradeBands: [],
        subjectGroups: [],
        customSections: [],
      };
      const pdf = await generateReportCardPdf({
        ...baseReportCard,
        subjects: [{ subject: "Maths", marks: 90, maxMarks: 100, grade: "A+" }],
        template,
      });
      expect(isValidPdf(pdf)).toBe(true);
    } finally {
      setStorageProvider(null);
    }
  });
});

describe("manual fee receipt PDF", () => {
  const manual = {
    schoolName: "Springfield Public School",
    studentName: "Aarav Sharma",
    admissionNo: "ADM-2026-0042",
    classSection: "10-A",
    feeTitle: "Annual Fee",
    amount: "Rs. 10,000",
    paymentMethod: "UPI",
    receiptNumber: "SS-20260704-ABC12345",
    paidAt: "04 Jul 2026, 10:30 AM",
    referenceNumber: "UPI-REF-123",
    remarks: "July installment",
    paidTillDate: "Rs. 30,000",
    remainingAmount: "Rs. 20,000",
    gatewayPaymentId: null,
  };

  it("includes the manual ledger fields and INR text", () => {
    const s = generateReceiptPdf(manual).toString("latin1");
    expect(s).toContain("Admission No: ADM-2026-0042");
    expect(s).toContain("Amount Received: Rs. 10,000");
    expect(s).toContain("Paid Till Date: Rs. 30,000");
    expect(s).toContain("Remaining Amount: Rs. 20,000");
    expect(s).toContain("Rs.");
  });

  it("does NOT render a gateway payment id for manual records", () => {
    const s = generateReceiptPdf(manual).toString("latin1");
    expect(s).not.toContain("Gateway Payment ID");
  });

  it("still surfaces the gateway id for legacy ONLINE records", () => {
    const s = generateReceiptPdf({ ...manual, gatewayPaymentId: "pay_LEGACY123" }).toString("latin1");
    expect(s).toContain("Gateway Payment ID: pay_LEGACY123");
  });

  it("omits optional fields cleanly when absent", () => {
    const s = generateReceiptPdf({ ...manual, admissionNo: null, referenceNumber: null, remarks: null }).toString("latin1");
    expect(s).not.toContain("Admission No:");
    expect(s).not.toContain("Reference:");
    expect(isValidPdf(generateReceiptPdf(manual))).toBe(true);
  });
});
