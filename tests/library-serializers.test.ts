import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { serializeBook, serializeCopy, serializeLoan, serializeReservationPublic, serializeReservationStaff } from "@/lib/library/serializers";

const TZ = "Asia/Kolkata";

function baseCopy(over: Record<string, unknown> = {}) {
  return {
    id: "c1", schoolId: "s1", bookId: "b1", accessionNumber: "ACC-1", barcode: "BAR-1",
    shelfLocation: "A1", acquisitionDate: null, acquisitionCost: new Prisma.Decimal("120.5"),
    condition: "GOOD", status: "AVAILABLE", statusReason: null, statusChangedAt: null,
    statusChangedById: "should-not-leak", createdAt: new Date(), updatedAt: new Date(), ...over,
  } as never;
}

describe("serializeCopy", () => {
  it("formats money to 2dp and omits internal storage/actor fields", () => {
    const out = serializeCopy(baseCopy());
    expect(out.acquisitionCost).toBe("120.50");
    expect(JSON.stringify(out)).not.toContain("statusChangedById");
    expect(JSON.stringify(out)).not.toContain("storageKey");
  });
});

describe("serializeBook", () => {
  it("never exposes a storageKey and computes availability from copies", () => {
    const book = {
      id: "b1", title: "T", subtitle: null, authors: "A", isbn10: null, isbn13: "978",
      publisher: null, edition: null, publicationYear: null, language: null, category: "Sci",
      subject: null, description: null, coverFileId: "file1", status: "ACTIVE",
      archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
      copies: [baseCopy({ status: "AVAILABLE" }), baseCopy({ id: "c2", status: "ISSUED" })],
    } as never;
    const out = serializeBook(book);
    expect(out.coverFileId).toBe("file1");
    expect(out.availableCopies).toBe(1);
    expect(out.totalCopies).toBe(2);
    expect(JSON.stringify(out)).not.toContain("storageKey");
  });
});

describe("serializeLoan", () => {
  it("computes overdue + outstanding fine (assessed minus waived)", () => {
    const loan = {
      id: "l1", status: "ACTIVE", bookCopyId: "c1", studentId: "st1", teacherId: null,
      issuedAt: new Date("2026-07-01"), dueAt: new Date("2026-07-05T00:00:00Z"),
      returnedAt: null, renewalCount: 1, finalCondition: null,
      fineAssessed: new Prisma.Decimal("10.00"), fineWaived: new Prisma.Decimal("4.00"),
      fineWaivedReason: null, fineWaivedAt: null, createdAt: new Date(),
      bookCopy: { accessionNumber: "ACC-1", bookId: "b1", book: { title: "T" } },
    } as never;
    const out = serializeLoan(loan, { timezone: TZ, now: new Date("2026-07-10T00:00:00Z") });
    expect(out.borrowerType).toBe("STUDENT");
    expect(out.overdue).toBe(true);
    expect(out.fineOutstanding).toBe("6.00");
    expect(out.bookTitle).toBe("T");
  });
});

describe("reservation privacy", () => {
  const reservation = {
    id: "r1", schoolId: "s1", bookId: "b1", studentId: "st1", teacherId: null, status: "PENDING",
    requestedAt: new Date(), fulfilledAt: null, cancelledAt: null, cancelledById: null,
    cancelReason: null, expiresAt: null, allocatedCopyId: null, createdAt: new Date(), updatedAt: new Date(),
    book: { title: "T" },
  } as never;

  it("public DTO NEVER exposes borrower identity, only queue position", () => {
    const out = serializeReservationPublic(reservation, { queuePosition: 2 });
    expect(out.queuePosition).toBe(2);
    expect(JSON.stringify(out)).not.toContain("st1");
    expect((out as Record<string, unknown>).borrowerId).toBeUndefined();
  });

  it("staff DTO DOES expose borrower identity (staff are authorized)", () => {
    const out = serializeReservationStaff(reservation, { queuePosition: 2 });
    expect(out.borrowerType).toBe("STUDENT");
    expect(out.borrowerId).toBe("st1");
  });

  it("marks a past-hold PENDING reservation as EXPIRED on read", () => {
    const expired = { ...(reservation as object), expiresAt: new Date("2000-01-01") } as never;
    const out = serializeReservationPublic(expired, { now: new Date() });
    expect(out.status).toBe("EXPIRED");
  });
});
