"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  DOCUMENTS_PENDING: "Documents pending",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  ASSESSMENT_SCHEDULED: "Assessment scheduled",
  WAITLISTED: "Waitlisted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  ENROLLED: "Enrolled",
};

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "DOCUMENTS_PENDING", "WITHDRAWN"],
  UNDER_REVIEW: ["DOCUMENTS_PENDING", "INTERVIEW_SCHEDULED", "ASSESSMENT_SCHEDULED", "WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"],
  DOCUMENTS_PENDING: ["UNDER_REVIEW", "WITHDRAWN"],
  INTERVIEW_SCHEDULED: ["UNDER_REVIEW", "WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"],
  ASSESSMENT_SCHEDULED: ["UNDER_REVIEW", "WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"],
  WAITLISTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"],
  APPROVED: ["WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
  ENROLLED: [],
};
const DECISION_STATUSES = new Set(["WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"]);

type Application = {
  id: string;
  status: string;
  applicationNumber: string;
  applicant: { firstName: string; middleName: string | null; lastName: string; dob: string; gender: string | null };
  guardian: { name: string; relation: string; phone: string; email: string | null };
  address: Record<string, string | null>;
  version: number;
  submittedAt: string | null;
  enrolledStudentId: string | null;
};

export default function ApplicationDetailClient({
  schoolId,
  applicationId,
  canManageEnrollment,
  initial,
  requestedClassName,
  classes,
  teachers,
}: {
  schoolId: string;
  applicationId: string;
  canManageEnrollment: boolean;
  initial: Application;
  requestedClassName: string;
  classes: { id: string; name: string; sections: { id: string; name: string }[] }[];
  teachers: { id: string; name: string }[];
}) {
  const [app, setApp] = useState(initial);
  const [notes, setNotes] = useState<{ id: string; type: string; body: string; createdAt: string }[]>([]);
  const [documents, setDocuments] = useState<{ id: string; documentType: string; originalFilename: string; verificationStatus: string; createdAt: string }[]>([]);
  const [events, setEvents] = useState<{ id: string; type: string; scheduledAt: string; status: string; evaluatorTeacherId: string | null }[]>([]);
  const [history, setHistory] = useState<{ id: string; previousStatus: string | null; newStatus: string; reason: string | null; createdAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nextStatus, setNextStatus] = useState("");
  const [reason, setReason] = useState("");
  const [noteType, setNoteType] = useState("INTERNAL");
  const [noteBody, setNoteBody] = useState("");
  const [enrollSectionId, setEnrollSectionId] = useState("");
  const [confirmEnroll, setConfirmEnroll] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ studentId: string; name: string }[] | null>(null);
  const [enrolledStudentId, setEnrolledStudentId] = useState<string | null>(app.enrolledStudentId);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState("");
  const [rejectReasonByDoc, setRejectReasonByDoc] = useState<Record<string, string>>({});

  const [eventType, setEventType] = useState("INTERVIEW");
  const [eventScheduledAt, setEventScheduledAt] = useState("");
  const [eventEvaluatorId, setEventEvaluatorId] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventInstructions, setEventInstructions] = useState("");

  const base = `/api/schools/${schoolId}/admissions/applications/${applicationId}`;

  const refreshAll = useCallback(async () => {
    const [notesRes, docsRes, eventsRes, historyRes, appRes] = await Promise.all([
      fetch(`${base}/notes`),
      fetch(`${base}/documents`),
      fetch(`${base}/review-events`),
      fetch(`${base}/status-history`),
      fetch(base),
    ]);
    if (notesRes.ok) setNotes(await notesRes.json());
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (eventsRes.ok) setEvents(await eventsRes.json());
    if (historyRes.ok) setHistory(await historyRes.json());
    if (appRes.ok) setApp(await appRes.json());
  }, [base]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  async function submitApplication() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Submit failed");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition() {
    if (!nextStatus) return;
    if (DECISION_STATUSES.has(nextStatus) && !reason.trim()) {
      setError("A reason is required for this decision.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason: reason || undefined, version: app.version }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Transition failed");
      setNextStatus("");
      setReason("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: noteType, body: noteBody }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add note");
      setNoteBody("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setBusy(false);
    }
  }

  async function enroll(confirmedDuplicate = false) {
    if (!enrollSectionId) {
      setError("Select a section to enroll into.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: enrollSectionId, confirmedDuplicate }),
      });
      const body = await res.json();
      if (res.status === 409 && body.code === "DUPLICATE_CANDIDATE") {
        setDuplicateCandidates(body.candidates);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Enrollment failed");
      setEnrolledStudentId(body.student.id);
      setDuplicateCandidates(null);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument() {
    if (!uploadFile || !uploadDocType.trim()) {
      setError("Select a file and a document type.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("documentType", uploadDocType.trim());
      const res = await fetch(`${base}/documents`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      setUploadFile(null);
      setUploadDocType("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDocument(documentId: string, verificationStatus: "VERIFIED" | "REJECTED") {
    const reviewReason = rejectReasonByDoc[documentId]?.trim();
    if (verificationStatus === "REJECTED" && !reviewReason) {
      setError("A reason is required to reject a document.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationStatus, reviewReason: reviewReason || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Document review failed");
      setRejectReasonByDoc((prev) => ({ ...prev, [documentId]: "" }));
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document review failed");
    } finally {
      setBusy(false);
    }
  }

  async function scheduleEvent() {
    if (!eventScheduledAt) {
      setError("Select a date/time to schedule.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/review-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: eventType,
          scheduledAt: new Date(eventScheduledAt).toISOString(),
          evaluatorTeacherId: eventEvaluatorId || undefined,
          location: eventLocation || undefined,
          instructions: eventInstructions || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Scheduling failed");
      setEventScheduledAt("");
      setEventEvaluatorId("");
      setEventLocation("");
      setEventInstructions("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scheduling failed");
    } finally {
      setBusy(false);
    }
  }

  const applicantName = [app.applicant.firstName, app.applicant.middleName, app.applicant.lastName].filter(Boolean).join(" ");
  const allowedNext = TRANSITIONS[app.status] ?? [];
  const requestedClass = classes.find((c) => c.name === requestedClassName);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{applicantName}</h1>
          <p className="text-sm text-muted-foreground">
            {app.applicationNumber} · Requested class: {requestedClassName}
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {STATUS_LABELS[app.status] ?? app.status}
        </Badge>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Applicant</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>DOB: {app.applicant.dob}</p>
            <p>Gender: {app.applicant.gender ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Guardian</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>{app.guardian.name} ({app.guardian.relation})</p>
            <p>{app.guardian.phone}{app.guardian.email ? ` · ${app.guardian.email}` : ""}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status & review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {app.status === "DRAFT" && (
            <Button onClick={submitApplication} disabled={busy}>
              Submit application
            </Button>
          )}
          {allowedNext.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Move to</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value)}
                >
                  <option value="">Select status</option>
                  {allowedNext.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              {nextStatus && DECISION_STATUSES.has(nextStatus) && (
                <div className="flex-1 min-w-[200px]">
                  <Label>Reason (required)</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for this decision" />
                </div>
              )}
              {nextStatus && (
                <Button onClick={transition} disabled={busy} variant={nextStatus === "REJECTED" ? "destructive" : "default"}>
                  Confirm: {STATUS_LABELS[nextStatus]}
                </Button>
              )}
            </div>
          )}

          {app.status === "APPROVED" && canManageEnrollment && !enrolledStudentId && (
            <div className="border-t pt-3 space-y-2">
              <h4 className="text-sm font-semibold">Enroll student</h4>
              <p className="text-xs text-muted-foreground">
                This creates a real Student record and cannot be undone. Select the section to place the student in.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={enrollSectionId}
                  onChange={(e) => setEnrollSectionId(e.target.value)}
                >
                  <option value="">Select section</option>
                  {requestedClass?.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmEnroll} onChange={(e) => setConfirmEnroll(e.target.checked)} />
                  I confirm I want to enroll this student — this action is irreversible.
                </label>
                <Button disabled={!confirmEnroll || busy} onClick={() => enroll(false)}>
                  Enroll student
                </Button>
              </div>
              {duplicateCandidates && duplicateCandidates.length > 0 && (
                <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm space-y-2">
                  <p>Possible duplicate student(s) found:</p>
                  <ul className="list-disc pl-5">
                    {duplicateCandidates.map((c) => (
                      <li key={c.studentId}>{c.name}</li>
                    ))}
                  </ul>
                  <Button size="sm" variant="outline" onClick={() => enroll(true)}>
                    Proceed anyway (confirmed not a duplicate)
                  </Button>
                </div>
              )}
            </div>
          )}
          {enrolledStudentId && (
            <p className="text-sm text-green-700">
              Enrolled as student <span className="font-mono">{enrolledStudentId}</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Internal notes & applicant-visible messages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="text-sm border rounded-md p-2">
                  <Badge variant={n.type === "INTERNAL" ? "secondary" : "outline"} className="mb-1">
                    {n.type === "INTERNAL" ? "Internal" : "Applicant-visible"}
                  </Badge>
                  <p>{n.body}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                <option value="INTERNAL">Internal (staff-only)</option>
                <option value="APPLICANT_VISIBLE">Applicant-visible</option>
              </select>
              <Textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note..." />
              <Button size="sm" onClick={addNote} disabled={busy}>
                Add note
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
            {history.map((h) => (
              <div key={h.id} className="text-sm border-b pb-2 last:border-0">
                <p>
                  {h.previousStatus ? `${STATUS_LABELS[h.previousStatus]} → ` : ""}
                  {STATUS_LABELS[h.newStatus] ?? h.newStatus}
                </p>
                {h.reason && <p className="text-muted-foreground text-xs">{h.reason}</p>}
                <p className="text-muted-foreground text-xs">{new Date(h.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded.</p>}
          {documents.map((d) => (
            <div key={d.id} className="text-sm border-b pb-2 last:border-0 space-y-2">
              <div className="flex items-center justify-between">
                <span>
                  {d.documentType} — {d.originalFilename}
                </span>
                <Badge variant={d.verificationStatus === "VERIFIED" ? "success" : d.verificationStatus === "REJECTED" ? "destructive" : "secondary"}>
                  {d.verificationStatus}
                </Badge>
              </div>
              {d.verificationStatus === "PENDING" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => verifyDocument(d.id, "VERIFIED")}>
                    Verify
                  </Button>
                  <Input
                    className="h-9 w-48"
                    placeholder="Rejection reason"
                    value={rejectReasonByDoc[d.id] ?? ""}
                    onChange={(e) => setRejectReasonByDoc((prev) => ({ ...prev, [d.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => verifyDocument(d.id, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          <div className="border-t pt-3 space-y-2">
            <Label>Upload document</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-9 w-48"
                placeholder="Document type (e.g. Birth certificate)"
                value={uploadDocType}
                onChange={(e) => setUploadDocType(e.target.value)}
              />
              <input
                type="file"
                aria-label="Document file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <Button size="sm" disabled={busy || !uploadFile || !uploadDocType.trim()} onClick={uploadDocument}>
                Upload
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interviews & assessments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.length === 0 && <p className="text-sm text-muted-foreground">None scheduled.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
              <span>
                {ev.type} — {new Date(ev.scheduledAt).toLocaleString()}
                {ev.evaluatorTeacherId ? ` · ${teachers.find((t) => t.id === ev.evaluatorTeacherId)?.name ?? ev.evaluatorTeacherId}` : ""}
              </span>
              <Badge variant="outline">{ev.status}</Badge>
            </div>
          ))}
          <div className="border-t pt-3 space-y-2">
            <Label>Schedule new interview/assessment</Label>
            <div className="flex flex-wrap items-end gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              >
                <option value="INTERVIEW">Interview</option>
                <option value="ASSESSMENT">Assessment</option>
              </select>
              <Input
                className="h-9"
                type="datetime-local"
                aria-label="Scheduled at"
                value={eventScheduledAt}
                onChange={(e) => setEventScheduledAt(e.target.value)}
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={eventEvaluatorId}
                onChange={(e) => setEventEvaluatorId(e.target.value)}
              >
                <option value="">No evaluator assigned</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Input
                className="h-9 w-40"
                placeholder="Location (optional)"
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
              />
              <Input
                className="h-9 w-48"
                placeholder="Instructions (optional)"
                value={eventInstructions}
                onChange={(e) => setEventInstructions(e.target.value)}
              />
              <Button size="sm" disabled={busy} onClick={scheduleEvent}>
                Schedule
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
