/**
 * Explicit per-response serializers. Never spread a raw Prisma row into a
 * JSON response — this is the deliberate boundary that keeps internal notes,
 * storage keys, and other staff-only fields from ever leaking to a response
 * shape that wasn't built to include them.
 */

type CycleRow = {
  id: string;
  schoolId: string;
  sessionLabel: string;
  name: string;
  applicationStartAt: Date;
  applicationEndAt: Date;
  status: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCycle(c: CycleRow) {
  return {
    id: c.id,
    sessionLabel: c.sessionLabel,
    name: c.name,
    applicationStartAt: c.applicationStartAt.toISOString(),
    applicationEndAt: c.applicationEndAt.toISOString(),
    status: c.status,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

type OfferingRow = {
  id: string;
  admissionCycleId: string;
  classId: string;
  capacity: number;
  applicationsOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
  class?: { id: string; name: string } | null;
};

export function serializeOffering(o: OfferingRow) {
  return {
    id: o.id,
    admissionCycleId: o.admissionCycleId,
    classId: o.classId,
    className: o.class?.name ?? null,
    capacity: o.capacity,
    applicationsOpen: o.applicationsOpen,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

type ApplicationRow = {
  id: string;
  schoolId: string;
  admissionCycleId: string;
  admissionOfferingId: string;
  applicationNumber: string;
  status: string;
  applicantFirstName: string;
  applicantMiddleName: string | null;
  applicantLastName: string;
  applicantDob: Date;
  applicantGender: string | null;
  currentSchoolName: string | null;
  previousSchoolName: string | null;
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  guardianEmail: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  source: string | null;
  overrideReason: string | null;
  submittedAt: Date | null;
  decisionAt: Date | null;
  decidedById: string | null;
  enrolledStudentId: string | null;
  createdById: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  admissionOffering?: { id: string; classId: string; class?: { name: string } | null } | null;
};

/** Row shape needed for the bounded, table-only list view. */
export function serializeApplicationListItem(a: ApplicationRow) {
  return {
    id: a.id,
    applicationNumber: a.applicationNumber,
    status: a.status,
    applicantName: [a.applicantFirstName, a.applicantMiddleName, a.applicantLastName].filter(Boolean).join(" "),
    requestedClassName: a.admissionOffering?.class?.name ?? null,
    guardianName: a.guardianName,
    guardianPhone: a.guardianPhone,
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function serializeApplicationDetail(a: ApplicationRow) {
  return {
    id: a.id,
    admissionCycleId: a.admissionCycleId,
    admissionOfferingId: a.admissionOfferingId,
    applicationNumber: a.applicationNumber,
    status: a.status,
    applicant: {
      firstName: a.applicantFirstName,
      middleName: a.applicantMiddleName,
      lastName: a.applicantLastName,
      dob: a.applicantDob.toISOString().slice(0, 10),
      gender: a.applicantGender,
    },
    schoolHistory: {
      currentSchoolName: a.currentSchoolName,
      previousSchoolName: a.previousSchoolName,
    },
    guardian: {
      name: a.guardianName,
      relation: a.guardianRelation,
      phone: a.guardianPhone,
      email: a.guardianEmail,
    },
    address: {
      line1: a.addressLine1,
      line2: a.addressLine2,
      city: a.addressCity,
      state: a.addressState,
      postalCode: a.addressPostalCode,
    },
    source: a.source,
    overrideReason: a.overrideReason,
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    decisionAt: a.decisionAt ? a.decisionAt.toISOString() : null,
    decidedById: a.decidedById,
    enrolledStudentId: a.enrolledStudentId,
    createdById: a.createdById,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

type DocumentRow = {
  id: string;
  applicationId: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  verificationStatus: string;
  reviewReason: string | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  uploadedById: string;
  createdAt: Date;
};

/** Never includes the raw storage key — downloads go through the authorized route only. */
export function serializeDocument(d: DocumentRow) {
  return {
    id: d.id,
    documentType: d.documentType,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    size: d.size,
    verificationStatus: d.verificationStatus,
    reviewReason: d.reviewReason,
    verifiedById: d.verifiedById,
    verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
    uploadedById: d.uploadedById,
    createdAt: d.createdAt.toISOString(),
  };
}

type ReviewEventRow = {
  id: string;
  applicationId: string;
  type: string;
  scheduledAt: Date;
  evaluatorTeacherId: string | null;
  location: string | null;
  instructions: string | null;
  status: string;
  score: number | null;
  maxScore: number | null;
  result: string | null;
  notes: string | null;
  createdById: string;
  createdAt: Date;
};

export function serializeReviewEvent(e: ReviewEventRow, opts: { includeInternal: boolean }) {
  return {
    id: e.id,
    type: e.type,
    scheduledAt: e.scheduledAt.toISOString(),
    evaluatorTeacherId: e.evaluatorTeacherId,
    location: e.location,
    instructions: e.instructions,
    status: e.status,
    score: e.score,
    maxScore: e.maxScore,
    // `result`/`notes` are internal evaluator output — never surfaced to a
    // non-staff caller (kept flag-gated for future applicant-visible use).
    result: opts.includeInternal ? e.result : null,
    notes: opts.includeInternal ? e.notes : null,
    createdAt: e.createdAt.toISOString(),
  };
}

type NoteRow = { id: string; type: string; body: string; authorId: string; createdAt: Date };

/** Caller MUST pre-filter INTERNAL notes out of `rows` before calling this for a non-staff audience. */
export function serializeNote(n: NoteRow) {
  return { id: n.id, type: n.type, body: n.body, authorId: n.authorId, createdAt: n.createdAt.toISOString() };
}

type HistoryRow = {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  actorId: string;
  createdAt: Date;
};

export function serializeStatusHistory(h: HistoryRow) {
  return {
    id: h.id,
    previousStatus: h.previousStatus,
    newStatus: h.newStatus,
    reason: h.reason,
    actorId: h.actorId,
    createdAt: h.createdAt.toISOString(),
  };
}
