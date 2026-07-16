import { z } from "zod";
import {
  ADMISSION_CYCLE_STATUSES,
  ADMISSION_DOCUMENT_ALLOWED_MIME_TYPES,
  ADMISSION_DOCUMENT_MAX_BYTES,
  ADMISSION_NOTE_TYPES,
  ADMISSION_REVIEW_EVENT_STATUSES,
  ADMISSION_REVIEW_EVENT_TYPES,
  ADMISSION_APPLICATION_STATUSES,
} from "@/lib/admissions/constants";

/**
 * Strict Zod boundary schemas for every admissions API route.
 *
 * Every schema here uses `.strict()` so unknown keys are rejected outright —
 * matching the convention this module derives from the repo's existing API
 * routes (e.g. src/app/api/schools/[schoolId]/students/route.ts,
 * .../guardians/route.ts), which `.parse()` a plain z.object(). Server-derived
 * identity/audit fields (schoolId, createdById, decidedById, verifiedById,
 * uploadedById, enrolledStudentId, actorId on status history, version bumps)
 * are never accepted as input fields on ANY schema below — they are always
 * computed from the authenticated session/actor, never from the request body.
 */

const MIN_DOB = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 100);
  return d;
};

const dobSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date of birth" })
  .refine((v) => new Date(v) < new Date(), { message: "Date of birth must be in the past" })
  .refine((v) => new Date(v) >= MIN_DOB(), { message: "Date of birth is not reasonable (more than 100 years ago)" });

export const admissionCycleCreateSchema = z
  .object({
    sessionLabel: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(120),
    applicationStartAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start date"),
    applicationEndAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid end date"),
  })
  .strict()
  .refine((d) => new Date(d.applicationStartAt) < new Date(d.applicationEndAt), {
    message: "applicationStartAt must be before applicationEndAt",
    path: ["applicationEndAt"],
  });

export const admissionCycleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    applicationStartAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start date").optional(),
    applicationEndAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid end date").optional(),
  })
  .strict()
  .refine(
    (d) => !d.applicationStartAt || !d.applicationEndAt || new Date(d.applicationStartAt) < new Date(d.applicationEndAt),
    { message: "applicationStartAt must be before applicationEndAt", path: ["applicationEndAt"] }
  );

export const admissionCycleStatusSchema = z
  .object({ status: z.enum(ADMISSION_CYCLE_STATUSES) })
  .strict();

export const admissionOfferingCreateSchema = z
  .object({
    classId: z.string().min(1),
    capacity: z.number().int().min(0),
    applicationsOpen: z.boolean().default(true),
  })
  .strict();

export const admissionOfferingUpdateSchema = z
  .object({
    capacity: z.number().int().min(0).optional(),
    applicationsOpen: z.boolean().optional(),
  })
  .strict();

const admissionApplicationFields = {
    admissionCycleId: z.string().min(1),
    admissionOfferingId: z.string().min(1),
    applicantFirstName: z.string().trim().min(1).max(80),
    applicantMiddleName: z.string().trim().max(80).optional().or(z.literal("")),
    applicantLastName: z.string().trim().min(1).max(80),
    applicantDob: dobSchema,
    applicantGender: z.string().trim().max(30).optional().or(z.literal("")),
    currentSchoolName: z.string().trim().max(160).optional().or(z.literal("")),
    previousSchoolName: z.string().trim().max(160).optional().or(z.literal("")),
    guardianName: z.string().trim().min(1).max(120),
    guardianRelation: z.string().trim().min(1).max(40),
    guardianPhone: z.string().trim().min(5).max(20),
    guardianEmail: z.string().email().optional().or(z.literal("")),
    addressLine1: z.string().trim().max(160).optional().or(z.literal("")),
    addressLine2: z.string().trim().max(160).optional().or(z.literal("")),
    addressCity: z.string().trim().max(80).optional().or(z.literal("")),
    addressState: z.string().trim().max(80).optional().or(z.literal("")),
    addressPostalCode: z.string().trim().max(20).optional().or(z.literal("")),
    source: z.string().trim().max(80).optional().or(z.literal("")),
};

export const admissionApplicationCreateSchema = z.object(admissionApplicationFields).strict();

export const admissionApplicationUpdateSchema = z
  .object(admissionApplicationFields)
  .partial()
  .omit({ admissionCycleId: true, admissionOfferingId: true })
  .strict();

export const admissionSubmitSchema = z
  .object({
    // Explicit admin override for submitting outside an OPEN cycle/window —
    // always paired with a mandatory, audited reason. Authorization for WHO
    // may pass this flag is enforced server-side (config-write roles only),
    // never trusted purely because the flag is present.
    override: z.boolean().optional(),
    overrideReason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((d) => !d.override || Boolean(d.overrideReason), {
    message: "overrideReason is required when override is set",
    path: ["overrideReason"],
  });

export const admissionTransitionSchema = z
  .object({
    status: z.enum(ADMISSION_APPLICATION_STATUSES),
    reason: z.string().trim().max(1000).optional(),
    // Optimistic-concurrency token — required so a stale client can't clobber
    // a transition made by someone else in between.
    version: z.number().int().min(0),
  })
  .strict();

export const admissionNoteCreateSchema = z
  .object({
    type: z.enum(ADMISSION_NOTE_TYPES),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export const admissionReviewEventCreateSchema = z
  .object({
    type: z.enum(ADMISSION_REVIEW_EVENT_TYPES),
    scheduledAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid scheduledAt"),
    evaluatorTeacherId: z.string().min(1).optional(),
    location: z.string().trim().max(200).optional().or(z.literal("")),
    instructions: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .strict();

export const admissionReviewEventUpdateSchema = z
  .object({
    scheduledAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid scheduledAt").optional(),
    evaluatorTeacherId: z.string().min(1).nullable().optional(),
    location: z.string().trim().max(200).optional().or(z.literal("")),
    instructions: z.string().trim().max(2000).optional().or(z.literal("")),
    status: z.enum(ADMISSION_REVIEW_EVENT_STATUSES).optional(),
    score: z.number().int().min(0).optional(),
    maxScore: z.number().int().min(0).optional(),
    result: z.string().trim().max(2000).optional().or(z.literal("")),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .strict()
  .refine((d) => d.score === undefined || d.maxScore === undefined || d.score <= d.maxScore, {
    message: "score must be within [0, maxScore]",
    path: ["score"],
  });

export const admissionDocumentVerifySchema = z
  .object({
    verificationStatus: z.enum(["VERIFIED", "REJECTED"]),
    reviewReason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => d.verificationStatus !== "REJECTED" || Boolean(d.reviewReason), {
    message: "reviewReason is required when rejecting a document",
    path: ["reviewReason"],
  });

export const admissionEnrollSchema = z
  .object({
    sectionId: z.string().min(1),
    rollNo: z.string().trim().min(1).max(40).optional(),
    confirmedDuplicate: z.boolean().optional(),
  })
  .strict();

export const admissionListQuerySchema = z.object({
  cycleId: z.string().optional(),
  offeringId: z.string().optional(),
  status: z.enum(ADMISSION_APPLICATION_STATUSES).optional(),
  applicationNumber: z.string().optional(),
  applicantName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().optional(),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
});

export function normalizeOptionalString(v: string | undefined | null): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

export const ADMISSION_DOCUMENT_LIMITS = { maxBytes: ADMISSION_DOCUMENT_MAX_BYTES, allowedMimeTypes: ADMISSION_DOCUMENT_ALLOWED_MIME_TYPES };
