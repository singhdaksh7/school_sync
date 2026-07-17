/**
 * Library domain events — a deliberately minimal, delivery-free extension point.
 *
 * Library Management v1 sends NO notifications (that is a separate, independent
 * feature branch). These functions exist only so a future notification consumer
 * has a single, typed place to hook into each circulation moment without any
 * change to the circulation logic. They intentionally do nothing but return the
 * structured event payload today — no event bus, no delivery, no external
 * dependency. Do NOT import any notification-branch module here.
 */

export type LibraryDomainEvent =
  | { type: "BOOK_ISSUED"; schoolId: string; loanId: string; copyId: string; borrowerType: "STUDENT" | "TEACHER"; borrowerId: string; dueAt: Date }
  | { type: "DUE_SOON"; schoolId: string; loanId: string; borrowerType: "STUDENT" | "TEACHER"; borrowerId: string; dueAt: Date }
  | { type: "OVERDUE"; schoolId: string; loanId: string; borrowerType: "STUDENT" | "TEACHER"; borrowerId: string; dueAt: Date }
  | { type: "RESERVATION_AVAILABLE"; schoolId: string; reservationId: string; bookId: string; copyId: string; borrowerType: "STUDENT" | "TEACHER"; borrowerId: string }
  | { type: "FINE_ASSESSED"; schoolId: string; loanId: string; borrowerType: "STUDENT" | "TEACHER"; borrowerId: string; amount: string };

/**
 * Publishes a library domain event. v1: no-op passthrough (returns the event so
 * callers/tests can assert it was emitted). A future notifications branch can
 * replace the body with real dispatch without touching any call site.
 */
export function emitLibraryEvent(event: LibraryDomainEvent): LibraryDomainEvent {
  return event;
}
