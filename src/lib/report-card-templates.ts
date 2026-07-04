import { prisma } from "@/lib/prisma";
import type { ReportCardTemplate } from "@/generated/prisma/client";
import { resolveManagedOrLegacyFileUrl } from "@/lib/file-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LAYOUT_TYPES = ["CLASSIC", "MODERN", "COMPACT"] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];

export const PAPER_SIZES = ["A4_PORTRAIT", "A4_LANDSCAPE"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------
// JSON config shapes
// ---------------------------------------------------------------------------

export type GradeBand = { label: string; min: number; max: number };
export type SubjectGroup = { name: string; subjects: string[] };
export type CustomSectionField = { label: string; value: string };
export type CustomSection = { key: string; title: string; fields: CustomSectionField[] };

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { label: "A+", min: 90, max: 100 },
  { label: "A", min: 80, max: 89 },
  { label: "B", min: 70, max: 79 },
  { label: "C", min: 60, max: 69 },
  { label: "D", min: 50, max: 59 },
  { label: "F", min: 0, max: 49 },
];

/** Immutable reference to the exact managed asset embedded at generation time. */
export type ManagedAssetRef = { storageKey: string; contentType: string } | null;

/**
 * The portion of a template that is persisted into ReportCard.templateSnapshot.
 * Excludes DB-only metadata (id, schoolId, timestamps, name/description).
 *
 * `logoAsset`/`stampAsset`/`signatureAsset` pin the EXACT StoredFile object
 * used at generation time (by storage key, not by a mutable template FK) so a
 * later logo/stamp/signature replacement never changes a historical PDF — see
 * generateReportCardForStudent, which snapshots whatever the template's
 * asset relations resolve to at that moment.
 */
export type TemplateSnapshot = {
  templateName: string;
  layoutType: LayoutType;
  paperSize: PaperSize;
  logoUrl: string | null;
  logoAsset: ManagedAssetRef;
  principalSignatureUrl: string | null;
  signatureAsset: ManagedAssetRef;
  classTeacherSignatureEnabled: boolean;
  stampUrl: string | null;
  stampAsset: ManagedAssetRef;
  watermarkText: string | null;
  backgroundImageUrl: string | null;
  footerText: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  showAttendance: boolean;
  showRank: boolean;
  showGrade: boolean;
  showRemarks: boolean;
  showSubjectTeacherRemarks: boolean;
  showClassTeacherRemarks: boolean;
  showCoCurricular: boolean;
  showSkills: boolean;
  showDiscipline: boolean;
  showAwards: boolean;
  showCustomFields: boolean;
  gradeBands: GradeBand[];
  subjectGroups: SubjectGroup[];
  customSections: CustomSection[];
};

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

export function parseGradeBands(value: unknown): GradeBand[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((band): band is GradeBand =>
      !!band &&
      typeof (band as GradeBand).label === "string" &&
      typeof (band as GradeBand).min === "number" &&
      typeof (band as GradeBand).max === "number"
    )
    .map((band) => ({ label: band.label, min: band.min, max: band.max }));
}

export function parseSubjectGroups(value: unknown): SubjectGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((group): group is SubjectGroup => !!group && typeof (group as SubjectGroup).name === "string")
    .map((group) => ({
      name: group.name,
      subjects: Array.isArray(group.subjects) ? group.subjects.filter((s): s is string => typeof s === "string") : [],
    }));
}

export function parseCustomSections(value: unknown): CustomSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((section): section is CustomSection =>
      !!section &&
      typeof (section as CustomSection).key === "string" &&
      typeof (section as CustomSection).title === "string"
    )
    .map((section) => ({
      key: section.key,
      title: section.title,
      fields: Array.isArray(section.fields)
        ? section.fields
            .filter((f): f is CustomSectionField => !!f && typeof f.label === "string")
            .map((f) => ({ label: f.label, value: typeof f.value === "string" ? f.value : "" }))
        : [],
    }));
}

/**
 * Normalize a template DB record for API responses (typed JSON arrays) and
 * resolve managed branding assets over legacy URL columns when present.
 */
export async function serializeTemplate(template: ReportCardTemplate) {
  const [logoUrl, stampUrl, principalSignatureUrl] = await Promise.all([
    resolveManagedOrLegacyFileUrl(template.logoUrl, template.logoFileId),
    resolveManagedOrLegacyFileUrl(template.stampUrl, template.stampFileId),
    resolveManagedOrLegacyFileUrl(template.principalSignatureUrl, template.principalSignatureFileId),
  ]);
  return {
    ...template,
    logoUrl,
    stampUrl,
    principalSignatureUrl,
    assignedClassIds: Array.isArray(template.assignedClassIds)
      ? (template.assignedClassIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [],
    gradeBands: parseGradeBands(template.gradeBands),
    subjectGroups: parseSubjectGroups(template.subjectGroups),
    customSections: parseCustomSections(template.customSections),
  };
}

export type TemplateWithAssets = ReportCardTemplate & {
  logoFile?: { storageKey: string; contentType: string } | null;
  stampFile?: { storageKey: string; contentType: string } | null;
  principalSignatureFile?: { storageKey: string; contentType: string } | null;
};

function assetRef(file: { storageKey: string; contentType: string } | null | undefined): ManagedAssetRef {
  return file ? { storageKey: file.storageKey, contentType: file.contentType } : null;
}

/** Build the immutable snapshot that is stored on a generated report card. */
export function templateToSnapshot(template: TemplateWithAssets): TemplateSnapshot {
  const gradeBands = parseGradeBands(template.gradeBands);
  return {
    templateName: template.name,
    layoutType: (LAYOUT_TYPES as readonly string[]).includes(template.layoutType)
      ? (template.layoutType as LayoutType)
      : "CLASSIC",
    paperSize: (PAPER_SIZES as readonly string[]).includes(template.paperSize)
      ? (template.paperSize as PaperSize)
      : "A4_PORTRAIT",
    logoUrl: template.logoUrl,
    logoAsset: assetRef(template.logoFile),
    principalSignatureUrl: template.principalSignatureUrl,
    signatureAsset: assetRef(template.principalSignatureFile),
    classTeacherSignatureEnabled: template.classTeacherSignatureEnabled,
    stampUrl: template.stampUrl,
    stampAsset: assetRef(template.stampFile),
    watermarkText: template.watermarkText,
    backgroundImageUrl: template.backgroundImageUrl,
    footerText: template.footerText,
    primaryColor: template.primaryColor,
    secondaryColor: template.secondaryColor,
    showAttendance: template.showAttendance,
    showRank: template.showRank,
    showGrade: template.showGrade,
    showRemarks: template.showRemarks,
    showSubjectTeacherRemarks: template.showSubjectTeacherRemarks,
    showClassTeacherRemarks: template.showClassTeacherRemarks,
    showCoCurricular: template.showCoCurricular,
    showSkills: template.showSkills,
    showDiscipline: template.showDiscipline,
    showAwards: template.showAwards,
    showCustomFields: template.showCustomFields,
    gradeBands: gradeBands.length > 0 ? gradeBands : DEFAULT_GRADE_BANDS,
    subjectGroups: parseSubjectGroups(template.subjectGroups),
    customSections: parseCustomSections(template.customSections),
  };
}

function normalizeAssetRef(value: unknown): ManagedAssetRef {
  if (!value || typeof value !== "object") return null;
  const ref = value as Partial<NonNullable<ManagedAssetRef>>;
  return typeof ref.storageKey === "string" && typeof ref.contentType === "string"
    ? { storageKey: ref.storageKey, contentType: ref.contentType }
    : null;
}

/** Coerce an arbitrary stored JSON snapshot back into a typed snapshot. */
export function normalizeSnapshot(value: unknown): TemplateSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snap = value as Partial<TemplateSnapshot>;
  const bands = parseGradeBands(snap.gradeBands);
  return {
    templateName: typeof snap.templateName === "string" ? snap.templateName : "Template",
    layoutType: (LAYOUT_TYPES as readonly string[]).includes(snap.layoutType as string)
      ? (snap.layoutType as LayoutType)
      : "CLASSIC",
    paperSize: (PAPER_SIZES as readonly string[]).includes(snap.paperSize as string)
      ? (snap.paperSize as PaperSize)
      : "A4_PORTRAIT",
    logoUrl: snap.logoUrl ?? null,
    logoAsset: normalizeAssetRef(snap.logoAsset),
    principalSignatureUrl: snap.principalSignatureUrl ?? null,
    signatureAsset: normalizeAssetRef(snap.signatureAsset),
    classTeacherSignatureEnabled: snap.classTeacherSignatureEnabled ?? true,
    stampUrl: snap.stampUrl ?? null,
    stampAsset: normalizeAssetRef(snap.stampAsset),
    watermarkText: snap.watermarkText ?? null,
    backgroundImageUrl: snap.backgroundImageUrl ?? null,
    footerText: snap.footerText ?? null,
    primaryColor: snap.primaryColor ?? null,
    secondaryColor: snap.secondaryColor ?? null,
    showAttendance: snap.showAttendance ?? true,
    showRank: snap.showRank ?? false,
    showGrade: snap.showGrade ?? true,
    showRemarks: snap.showRemarks ?? true,
    showSubjectTeacherRemarks: snap.showSubjectTeacherRemarks ?? true,
    showClassTeacherRemarks: snap.showClassTeacherRemarks ?? true,
    showCoCurricular: snap.showCoCurricular ?? false,
    showSkills: snap.showSkills ?? false,
    showDiscipline: snap.showDiscipline ?? false,
    showAwards: snap.showAwards ?? false,
    showCustomFields: snap.showCustomFields ?? false,
    gradeBands: bands.length > 0 ? bands : DEFAULT_GRADE_BANDS,
    subjectGroups: parseSubjectGroups(snap.subjectGroups),
    customSections: parseCustomSections(snap.customSections),
  };
}

// ---------------------------------------------------------------------------
// Grade band resolution
// ---------------------------------------------------------------------------

/** Resolve a letter grade from configurable bands, falling back to defaults. */
export function gradeFromBands(percentage: number, bands?: GradeBand[] | null): string {
  const list = bands && bands.length > 0 ? bands : DEFAULT_GRADE_BANDS;
  for (const band of list) {
    if (percentage >= band.min && percentage <= band.max) return band.label;
  }
  // Below the lowest band's min: use the last (lowest) band label.
  const sorted = [...list].sort((a, b) => a.min - b.min);
  return sorted[0]?.label ?? "F";
}

// ---------------------------------------------------------------------------
// Template selection
// ---------------------------------------------------------------------------

/**
 * Choose the template for a report card:
 *   1. a template whose assignedClassIds includes the student's class
 *   2. the school default template
 *   3. null  → caller falls back to the legacy/default layout
 */
export async function resolveTemplateForReportCard(input: {
  schoolId: string;
  classId?: string | null;
}): Promise<TemplateWithAssets | null> {
  const templates = await prisma.reportCardTemplate.findMany({
    where: { schoolId: input.schoolId },
    orderBy: { updatedAt: "desc" },
    include: {
      logoFile: { select: { storageKey: true, contentType: true } },
      stampFile: { select: { storageKey: true, contentType: true } },
      principalSignatureFile: { select: { storageKey: true, contentType: true } },
    },
  });
  if (templates.length === 0) return null;

  if (input.classId) {
    const assigned = templates.find((tpl) => {
      const ids = Array.isArray(tpl.assignedClassIds) ? (tpl.assignedClassIds as unknown[]) : [];
      return ids.some((id) => id === input.classId);
    });
    if (assigned) return assigned;
  }

  return templates.find((tpl) => tpl.isDefault) ?? null;
}

// ---------------------------------------------------------------------------
// Validation / sanitization for create + update payloads
// ---------------------------------------------------------------------------

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalColor(value: unknown): string | null | undefined {
  const color = optionalString(value);
  if (!color) return null;
  return HEX_COLOR_RE.test(color) ? color : undefined; // undefined = invalid
}

function boolField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export type TemplateInput = ReturnType<typeof buildTemplateData>;

/**
 * Validate and normalize a template payload. Returns `{ error }` on bad input,
 * otherwise `{ data }` ready to pass to prisma create/update.
 * `partial` controls whether boolean defaults are applied (create) or only
 * the provided fields are returned (patch).
 */
export function buildTemplateData(body: Record<string, unknown>, partial: boolean) {
  const name = optionalString(body.name);
  if (!partial && !name) return { error: "Template name is required" as const };

  const layoutType = body.layoutType;
  if (layoutType !== undefined && !(LAYOUT_TYPES as readonly string[]).includes(layoutType as string)) {
    return { error: "Invalid layout type" as const };
  }
  const paperSize = body.paperSize;
  if (paperSize !== undefined && !(PAPER_SIZES as readonly string[]).includes(paperSize as string)) {
    return { error: "Invalid paper size" as const };
  }

  const primaryColor = body.primaryColor !== undefined ? optionalColor(body.primaryColor) : null;
  if (primaryColor === undefined) return { error: "Primary color must be a hex color like #2563eb" as const };
  const secondaryColor = body.secondaryColor !== undefined ? optionalColor(body.secondaryColor) : null;
  if (secondaryColor === undefined) return { error: "Secondary color must be a hex color like #0f172a" as const };

  const assignedClassIds = Array.isArray(body.assignedClassIds)
    ? body.assignedClassIds.filter((id): id is string => typeof id === "string")
    : [];

  const gradeBands = parseGradeBands(body.gradeBands);
  const subjectGroups = parseSubjectGroups(body.subjectGroups);
  const customSections = parseCustomSections(body.customSections);

  const data = {
    ...(name !== null ? { name } : {}),
    description: optionalString(body.description),
    layoutType: (layoutType as string) ?? (partial ? undefined : "CLASSIC"),
    paperSize: (paperSize as string) ?? (partial ? undefined : "A4_PORTRAIT"),
    logoUrl: optionalString(body.logoUrl),
    principalSignatureUrl: optionalString(body.principalSignatureUrl),
    classTeacherSignatureEnabled: boolField(body.classTeacherSignatureEnabled, true),
    stampUrl: optionalString(body.stampUrl),
    watermarkText: optionalString(body.watermarkText),
    backgroundImageUrl: optionalString(body.backgroundImageUrl),
    footerText: optionalString(body.footerText),
    primaryColor,
    secondaryColor,
    showAttendance: boolField(body.showAttendance, true),
    showRank: boolField(body.showRank, false),
    showGrade: boolField(body.showGrade, true),
    showRemarks: boolField(body.showRemarks, true),
    showSubjectTeacherRemarks: boolField(body.showSubjectTeacherRemarks, true),
    showClassTeacherRemarks: boolField(body.showClassTeacherRemarks, true),
    showCoCurricular: boolField(body.showCoCurricular, false),
    showSkills: boolField(body.showSkills, false),
    showDiscipline: boolField(body.showDiscipline, false),
    showAwards: boolField(body.showAwards, false),
    showCustomFields: boolField(body.showCustomFields, false),
    assignedClassIds,
    gradeBands,
    subjectGroups,
    customSections,
  };

  // Drop undefined layout/paper keys for partial updates so we don't overwrite.
  if (data.layoutType === undefined) delete (data as Record<string, unknown>).layoutType;
  if (data.paperSize === undefined) delete (data as Record<string, unknown>).paperSize;

  return { data };
}

// ---------------------------------------------------------------------------
// Sample data for previews
// ---------------------------------------------------------------------------

export function sampleReportCardData() {
  return {
    schoolName: "Sample Public School",
    studentName: "Aarav Sharma",
    rollNo: "12",
    classSection: "Grade 8-A",
    examName: "Annual Examination 2026",
    rank: 3,
    subjects: [
      { subject: "Mathematics", marks: 92, maxMarks: 100, grade: "A+", subjectTeacherRemark: "Excellent problem solving." },
      { subject: "Science", marks: 85, maxMarks: 100, grade: "A", subjectTeacherRemark: "Strong conceptual grasp." },
      { subject: "English", marks: 78, maxMarks: 100, grade: "B", subjectTeacherRemark: "Good written expression." },
      { subject: "Social Studies", marks: 81, maxMarks: 100, grade: "A", subjectTeacherRemark: "Keen interest in history." },
      { subject: "Hindi", marks: 74, maxMarks: 100, grade: "B", subjectTeacherRemark: "Improving steadily." },
    ],
    totalMarks: 410,
    percentage: 82,
    grade: "A",
    attendance: { totalDays: 200, presentDays: 188, absentDays: 8, lateDays: 4, percentage: 94 },
    classTeacherRemark: "A diligent and well-rounded student. Keep up the good work!",
    generatedBy: "Mrs. Meera Iyer",
    publishedAt: new Date().toISOString(),
  };
}
