/**
 * Certificate PDF renderer. Uses pdf-lib (same dependency as
 * src/lib/report-card-pdf.ts — no Chromium/browser dependency, no external
 * network fetch during generation). Managed assets (school/template logo,
 * signatory signature) are fetched ONLY through readManagedFileBytes (no
 * SSRF surface, mirrors report-card-pdf.ts's embedManagedAsset). The QR
 * code is generated locally (the `qrcode` package rasterizes to a PNG
 * buffer in-process — no network call), encoding only the public
 * verification URL.
 */

import { PDFDocument, PDFFont, type RGB, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { readManagedFileBytes } from "@/lib/file-service";
import type { CertificateSnapshot } from "@/lib/certificates/snapshot";
import type { CertificateTypeValue } from "@/lib/certificates/constants";

const INK: RGB = rgb(0.1, 0.1, 0.12);
const MUTED: RGB = rgb(0.4, 0.42, 0.46);
const LINE: RGB = rgb(0.85, 0.86, 0.88);

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  if (!hex) return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedManagedAsset(pdfDoc: PDFDocument, asset: { storageKey: string; contentType: string } | null) {
  if (!asset) return null;
  try {
    const bytes = await readManagedFileBytes({ storageKey: asset.storageKey });
    if (!bytes) return null;
    if (asset.contentType === "image/png") return await pdfDoc.embedPng(bytes);
    if (asset.contentType === "image/jpeg") return await pdfDoc.embedJpg(bytes);
    return null; // WEBP/other: no native pdf-lib decoder — skip rather than fail the document.
  } catch (err) {
    console.error("[certificates-pdf] failed to embed managed asset", { storageKey: asset.storageKey, err });
    return null;
  }
}

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

const CERTIFICATE_TYPE_LABELS: Record<CertificateTypeValue, string> = {
  BONAFIDE: "Bonafide Certificate",
  TRANSFER_CERTIFICATE: "Transfer Certificate",
  CHARACTER_CERTIFICATE: "Character Certificate",
  STUDY_CERTIFICATE: "Study Certificate",
  CUSTOM: "Certificate",
};

export type CertificatePdfInput = {
  schoolName: string;
  schoolLogoAsset?: { storageKey: string; contentType: string } | null;
  primaryColor?: string | null;
  poweredBySchoolSync?: boolean;
  certificateType: CertificateTypeValue;
  customLabel?: string | null;
  certificateNumber: string;
  issueDate: string; // ISO date
  snapshot: CertificateSnapshot;
  bodyText: string; // already-rendered (placeholders substituted) plain text
  heading: string;
  signatoryName: string;
  signatoryDesignation: string;
  signatureAsset?: { storageKey: string; contentType: string } | null;
  footerText?: string | null;
  verificationUrl: string;
};

/**
 * Renders the certificate PDF. Returns the raw PDF bytes only — callers are
 * responsible for storing them through file-service.uploadManagedFile
 * (never write bytes directly to a route response without going through
 * managed storage first, per spec §7).
 */
export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 portrait, points
  const pageHeight = 841.89;
  const margin = 56;
  const primary = hexToRgb(input.primaryColor, rgb(0.145, 0.388, 0.922));

  const page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Header: logo + school name + certificate type label
  const logo = await embedManagedAsset(doc, input.schoolLogoAsset ?? null);
  if (logo) {
    const dims = logo.scale(36 / logo.height);
    page.drawImage(logo, { x: margin, y: y - 36, width: dims.width, height: 36 });
  }
  page.drawText(input.schoolName, {
    x: logo ? margin + 48 : margin,
    y: y - 14,
    size: 18,
    font: bold,
    color: primary,
  });
  const typeLabel = input.certificateType === "CUSTOM" ? input.customLabel ?? CERTIFICATE_TYPE_LABELS.CUSTOM : CERTIFICATE_TYPE_LABELS[input.certificateType];
  page.drawText(typeLabel, {
    x: logo ? margin + 48 : margin,
    y: y - 32,
    size: 11,
    font: regular,
    color: MUTED,
  });
  y -= 60;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: LINE });
  y -= 36;

  // Heading
  page.drawText(input.heading, { x: margin, y, size: 15, font: bold, color: INK });
  y -= 28;

  // Certificate number + issue date
  page.drawText(`Certificate No: ${input.certificateNumber}`, { x: margin, y, size: 10, font: regular, color: MUTED });
  page.drawText(`Issue Date: ${input.issueDate}`, { x: pageWidth - margin - 150, y, size: 10, font: regular, color: MUTED });
  y -= 30;

  // Body text — word-wrapped
  const bodyLines = input.bodyText.split(/\n+/).flatMap((para) => wrapByWidth(regular, para, 12, pageWidth - margin * 2));
  for (const line of bodyLines) {
    page.drawText(line, { x: margin, y, size: 12, font: regular, color: INK, lineHeight: 18 });
    y -= 20;
  }
  y -= 40;

  // Signatory block + QR
  const signature = await embedManagedAsset(doc, input.signatureAsset ?? null);
  const sigX = pageWidth - margin - 160;
  if (signature) {
    const dims = signature.scale(40 / signature.height);
    page.drawImage(signature, { x: sigX, y: y + 6, width: Math.min(dims.width, 160), height: 40 });
  }
  page.drawLine({ start: { x: sigX, y }, end: { x: sigX + 160, y }, thickness: 1, color: LINE });
  page.drawText(input.signatoryName, { x: sigX, y: y - 14, size: 11, font: bold, color: INK });
  page.drawText(input.signatoryDesignation, { x: sigX, y: y - 28, size: 9, font: regular, color: MUTED });

  // QR verification code (bottom-left)
  try {
    const qrDataUrl = await QRCode.toDataURL(input.verificationUrl, { margin: 0, width: 300 });
    const qrPng = Buffer.from(qrDataUrl.split(",")[1] ?? "", "base64");
    const qrImage = await doc.embedPng(qrPng);
    const qrSize = 70;
    page.drawImage(qrImage, { x: margin, y: y - 30, width: qrSize, height: qrSize });
    page.drawText("Scan to verify", { x: margin, y: y - 40, size: 8, font: regular, color: MUTED });
  } catch (err) {
    console.error("[certificates-pdf] failed to render QR code", err);
  }

  // Footer
  const footerParts = [input.footerText, input.poweredBySchoolSync !== false ? "Powered by SchoolSync" : null].filter(Boolean);
  if (footerParts.length > 0) {
    page.drawText(footerParts.join(" · "), { x: margin, y: margin / 2, size: 8, font: regular, color: MUTED });
  }

  return doc.save();
}
