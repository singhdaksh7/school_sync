/**
 * Production report-card PDF renderer. Uses pdf-lib (no Chromium/browser
 * dependency) so it embeds real images, colour, and deterministic pagination —
 * the previous pdf-lite-based renderer could only print asset URLs as text.
 *
 * Managed assets (logo/stamp/signature) are fetched through the file-service,
 * NEVER from an arbitrary remote URL (no SSRF surface) — see embedManagedAsset.
 * pdf-lib can only embed PNG/JPEG; a WEBP asset is safely skipped (falls back
 * to no image) rather than failing the whole document.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, degrees, type RGB } from "pdf-lib";
import { readManagedFileBytes } from "@/lib/file-service";
import type { ManagedAssetRef, TemplateSnapshot } from "@/lib/report-card-templates";

type ReportCardPdfInput = {
  schoolName: string;
  logoUrl?: string | null;
  /** School-level logo, used only when the template has no logo of its own. */
  schoolLogoAsset?: ManagedAssetRef;
  studentName: string;
  rollNo: string;
  classSection: string;
  examName: string;
  rank?: number | null;
  subjects: { subject: string; marks: number; maxMarks: number; grade: string; subjectTeacherRemark?: string | null }[];
  totalMarks: number;
  percentage: number;
  grade: string;
  attendance: {
    totalDays: number;
    presentDays: number;
    absentDays: number;
    lateDays: number;
    percentage: number | null;
  };
  classTeacherRemark?: string | null;
  generatedBy: string;
  publishedAt?: string | null;
  /** When present, rendering honors the template's branding/layout/section toggles. */
  template?: TemplateSnapshot | null;
};

const DEFAULT_PRIMARY: RGB = rgb(0.145, 0.388, 0.922); // #2563eb
const DEFAULT_SECONDARY: RGB = rgb(0.059, 0.09, 0.165); // #0f172a
const INK: RGB = rgb(0.1, 0.1, 0.12);
const MUTED: RGB = rgb(0.4, 0.42, 0.46);
const LINE: RGB = rgb(0.85, 0.86, 0.88);
const WHITE: RGB = rgb(1, 1, 1);

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  if (!hex) return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedManagedAsset(pdfDoc: PDFDocument, asset: ManagedAssetRef) {
  if (!asset) return null;
  try {
    const bytes = await readManagedFileBytes({ storageKey: asset.storageKey });
    if (!bytes) return null;
    if (asset.contentType === "image/png") return await pdfDoc.embedPng(bytes);
    if (asset.contentType === "image/jpeg") return await pdfDoc.embedJpg(bytes);
    // WEBP and any other type: pdf-lib has no native decoder — skip rather than fail the document.
    return null;
  } catch (err) {
    console.error("[report-card-pdf] failed to embed managed asset", { storageKey: asset.storageKey, err });
    return null;
  }
}

type Embedded = Awaited<ReturnType<PDFDocument["embedPng"]>>;

/** Greedy word-wrap using REAL font metrics (correct even for a proportional font). */
function wrapByWidth(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class DocBuilder {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  pageWidth: number;
  pageHeight: number;
  margin = 42;
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  primary: RGB;
  secondary: RGB;
  schoolName: string;
  watermarkText: string | null;

  private constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, pageWidth: number, pageHeight: number, primary: RGB, secondary: RGB, schoolName: string, watermarkText: string | null) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
    this.primary = primary;
    this.secondary = secondary;
    this.schoolName = schoolName;
    this.watermarkText = watermarkText;
  }

  static async create(pageWidth: number, pageHeight: number, primary: RGB, secondary: RGB, schoolName: string, watermarkText: string | null) {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const builder = new DocBuilder(doc, regular, bold, pageWidth, pageHeight, primary, secondary, schoolName, watermarkText);
    builder.addPage();
    return builder;
  }

  get contentWidth() {
    return this.pageWidth - this.margin * 2;
  }

  addPage() {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.y = this.pageHeight - this.margin;
    if (this.watermarkText) {
      this.page.drawText(this.watermarkText, {
        x: this.pageWidth / 2 - (this.watermarkText.length * 14) / 2,
        y: this.pageHeight / 2,
        size: 42,
        font: this.bold,
        color: rgb(0.85, 0.87, 0.9),
        opacity: 0.5,
        rotate: degrees(30),
      });
    }
    // Repeated running header on every page after the first.
    if (this.pages.length > 1) {
      this.page.drawText(this.schoolName, { x: this.margin, y: this.y, size: 10, font: this.bold, color: this.secondary });
      this.y -= 20;
      this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.pageWidth - this.margin, y: this.y }, thickness: 0.75, color: LINE });
      this.y -= 14;
    }
  }

  ensureSpace(height: number) {
    if (this.y - height < this.margin) this.addPage();
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: RGB; x?: number; gapAfter?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensureSpace(size + 4);
    this.page.drawText(value, {
      x: opts.x ?? this.margin,
      y: this.y - size,
      size,
      font: opts.bold ? this.bold : this.regular,
      color: opts.color ?? INK,
    });
    this.y -= size + (opts.gapAfter ?? 4);
  }

  wrapped(value: string, opts: { size?: number; bold?: boolean; color?: RGB; x?: number; maxWidth?: number; lineHeight?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const maxWidth = opts.maxWidth ?? this.contentWidth - (opts.x ? opts.x - this.margin : 0);
    const lines = wrapByWidth(font, value, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace((opts.lineHeight ?? size + 4));
      this.page.drawText(line, { x: opts.x ?? this.margin, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= opts.lineHeight ?? size + 4;
    }
  }

  gap(height: number) {
    this.y -= height;
  }

  rule(color: RGB = LINE) {
    this.ensureSpace(8);
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.pageWidth - this.margin, y: this.y }, thickness: 0.75, color });
    this.y -= 8;
  }

  async finish(): Promise<Buffer> {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      page.drawText(`Page ${i + 1} of ${total}`, {
        x: this.pageWidth - this.margin - 70,
        y: this.margin - 22 < 0 ? 10 : this.margin - 22,
        size: 8,
        font: this.regular,
        color: MUTED,
      });
    });
    // Plain (uncompressed-object) xref table — keeps the output a classic,
    // widely-compatible PDF/A-ish structure instead of newer object streams.
    const bytes = await this.doc.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  }
}

function drawImageBox(builder: DocBuilder, image: Embedded | null, x: number, topY: number, maxW: number, maxH: number) {
  if (!image) return;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  builder.page.drawImage(image, { x, y: topY - h, width: w, height: h });
}

export async function generateReportCardPdf(input: ReportCardPdfInput): Promise<Buffer> {
  const t = input.template;
  const landscape = t?.paperSize === "A4_LANDSCAPE";
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const primary = hexToRgb(t?.primaryColor, DEFAULT_PRIMARY);
  const secondary = hexToRgb(t?.secondaryColor, DEFAULT_SECONDARY);
  const watermarkText = t?.watermarkText ?? null;

  const b = await DocBuilder.create(pageWidth, pageHeight, primary, secondary, input.schoolName, watermarkText);

  // ── Header: logo (template asset, then school asset), school name, title ──
  const logoAsset = t?.logoAsset ?? input.schoolLogoAsset ?? null;
  const logoImage = await embedManagedAsset(b.doc, logoAsset);
  const headerTop = b.y;
  let textX = b.margin;
  if (logoImage) {
    drawImageBox(b, logoImage, b.margin, headerTop, 56, 56);
    textX = b.margin + 68;
  }
  b.page.drawText(input.schoolName, { x: textX, y: headerTop - 18, size: 18, font: b.bold, color: secondary });
  const layoutLabel = t ? `${t.layoutType} layout` : "Default layout";
  b.page.drawText(t ? `Final Report Card — ${layoutLabel}` : "Final Report Card", {
    x: textX,
    y: headerTop - 36,
    size: 11,
    font: b.regular,
    color: primary,
  });
  b.y = headerTop - Math.max(logoImage ? 60 : 0, 46);
  b.rule(primary);
  b.gap(4);

  // ── Student identity block ─────────────────────────────────────────────────
  b.text(`Student: ${input.studentName}`, { bold: true, size: 12 });
  b.text(`Roll No: ${input.rollNo}      Class/Section: ${input.classSection}`);
  b.text(`Exam: ${input.examName}`);
  if ((!t || t.showRank) && typeof input.rank === "number") {
    b.text(`Rank: ${input.rank}`);
  }
  b.gap(6);

  // ── Subject table ──────────────────────────────────────────────────────────
  const showGrade = !t || t.showGrade;
  const colSubject = b.margin;
  const colMarks = b.margin + b.contentWidth * 0.55;
  const colMax = b.margin + b.contentWidth * 0.68;
  const colGrade = b.margin + b.contentWidth * 0.82;
  const rowHeight = 16;

  const drawTableHeader = () => {
    b.ensureSpace(rowHeight + 4);
    b.page.drawRectangle({ x: b.margin, y: b.y - rowHeight, width: b.contentWidth, height: rowHeight, color: secondary });
    b.page.drawText("Subject", { x: colSubject + 4, y: b.y - rowHeight + 4, size: 9, font: b.bold, color: WHITE });
    b.page.drawText("Marks", { x: colMarks, y: b.y - rowHeight + 4, size: 9, font: b.bold, color: WHITE });
    b.page.drawText("Max", { x: colMax, y: b.y - rowHeight + 4, size: 9, font: b.bold, color: WHITE });
    if (showGrade) b.page.drawText("Grade", { x: colGrade, y: b.y - rowHeight + 4, size: 9, font: b.bold, color: WHITE });
    b.y -= rowHeight + 2;
  };
  drawTableHeader();

  for (const subject of input.subjects) {
    const nameLines = wrapByWidth(b.regular, subject.subject, 9.5, colMarks - colSubject - 8);
    const neededHeight = rowHeight * nameLines.length;
    if (b.y - neededHeight < b.margin) {
      b.addPage();
      drawTableHeader();
    }
    nameLines.forEach((line, i) => {
      const rowTop = b.y - rowHeight * (i + 1) + 4;
      b.page.drawText(line, { x: colSubject + 4, y: rowTop, size: 9.5, font: b.regular, color: INK });
      if (i === 0) {
        const marksText = String(subject.marks);
        const marksW = b.regular.widthOfTextAtSize(marksText, 9.5);
        b.page.drawText(marksText, { x: colMax - 8 - marksW, y: rowTop, size: 9.5, font: b.regular, color: INK });
        const maxText = String(subject.maxMarks);
        const maxW = b.regular.widthOfTextAtSize(maxText, 9.5);
        b.page.drawText(maxText, { x: colGrade - 8 - maxW, y: rowTop, size: 9.5, font: b.regular, color: INK });
        if (showGrade) b.page.drawText(subject.grade, { x: colGrade, y: rowTop, size: 9.5, font: b.bold, color: primary });
      }
    });
    b.y -= neededHeight;
    if (t?.showSubjectTeacherRemarks && subject.subjectTeacherRemark) {
      b.wrapped(`  Teacher: ${subject.subjectTeacherRemark}`, { size: 8.5, color: MUTED, maxWidth: b.contentWidth - 8 });
    }
    b.page.drawLine({ start: { x: b.margin, y: b.y + 2 }, end: { x: b.pageWidth - b.margin, y: b.y + 2 }, thickness: 0.5, color: LINE });
  }
  b.gap(8);

  // ── Totals / grading ────────────────────────────────────────────────────────
  b.text(`Total: ${input.totalMarks}      Percentage: ${input.percentage}%${showGrade ? `      Grade: ${input.grade}` : ""}`, { bold: true });
  if (t && t.showGrade && t.gradeBands.length > 0) {
    b.wrapped("Grading: " + t.gradeBands.map((band) => `${band.label} (${band.min}-${band.max})`).join("   "), { size: 8.5, color: MUTED });
  }
  b.gap(4);

  if (!t || t.showAttendance) {
    b.text(`Attendance: ${input.attendance.presentDays}/${input.attendance.totalDays} present (${input.attendance.percentage ?? "N/A"}%)`);
    b.text(`Absent: ${input.attendance.absentDays}, Late: ${input.attendance.lateDays}`);
  }
  b.gap(4);

  // ── Custom sections (co-curricular / skills / discipline / awards / custom) ─
  if (t) {
    const sectionVisible: Record<string, boolean> = {
      "co-curricular": t.showCoCurricular,
      cocurricular: t.showCoCurricular,
      skills: t.showSkills,
      discipline: t.showDiscipline,
      awards: t.showAwards,
    };
    if (t.showCustomFields || t.showCoCurricular || t.showSkills || t.showDiscipline || t.showAwards) {
      for (const section of t.customSections) {
        const key = section.key.toLowerCase();
        const visible = key in sectionVisible ? sectionVisible[key] : t.showCustomFields;
        if (!visible) continue;
        b.text(`${section.title}:`, { bold: true });
        for (const field of section.fields) {
          b.wrapped(`  ${field.label}: ${field.value}`, { size: 9.5 });
        }
        b.gap(2);
      }
    }
  }

  if ((!t || t.showRemarks) && (!t || t.showClassTeacherRemarks)) {
    b.wrapped(`Class Teacher Remark: ${input.classTeacherRemark || "N/A"}`);
  }
  b.text(`Generated By: ${input.generatedBy}`, { size: 8.5, color: MUTED });
  if (input.publishedAt) b.text(`Published At: ${input.publishedAt}`, { size: 8.5, color: MUTED });
  b.gap(10);

  // ── Signatures / stamp ──────────────────────────────────────────────────────
  const stampImage = await embedManagedAsset(b.doc, t?.stampAsset ?? null);
  const signatureImage = await embedManagedAsset(b.doc, t?.signatureAsset ?? null);
  b.ensureSpace(74);
  const sigTop = b.y;
  if (!t || t.classTeacherSignatureEnabled) {
    b.page.drawLine({ start: { x: b.margin, y: sigTop - 40 }, end: { x: b.margin + 140, y: sigTop - 40 }, thickness: 0.75, color: LINE });
    b.page.drawText("Class Teacher Signature", { x: b.margin, y: sigTop - 52, size: 8, font: b.regular, color: MUTED });
  }
  const principalX = b.pageWidth - b.margin - 160;
  if (signatureImage) drawImageBox(b, signatureImage, principalX, sigTop, 100, 34);
  b.page.drawLine({ start: { x: principalX, y: sigTop - 40 }, end: { x: principalX + 140, y: sigTop - 40 }, thickness: 0.75, color: LINE });
  b.page.drawText("Principal Signature", { x: principalX, y: sigTop - 52, size: 8, font: b.regular, color: MUTED });
  if (stampImage) drawImageBox(b, stampImage, (b.pageWidth - 70) / 2, sigTop, 70, 70);
  b.y = sigTop - 62;

  if (t?.footerText) {
    b.rule();
    b.wrapped(t.footerText, { size: 8, color: MUTED });
  }

  return b.finish();
}
