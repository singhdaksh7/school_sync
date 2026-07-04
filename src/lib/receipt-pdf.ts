import { renderTextPdf, type PdfLine } from "@/lib/pdf-lite";

type ReceiptPdfInput = {
  schoolName: string;
  studentName: string;
  admissionNo?: string | null;
  classSection: string;
  feeTitle: string;
  amount: string; // pre-formatted, e.g. "Rs. 10,000"
  paymentMethod: string;
  receiptNumber: string;
  paidAt: string;
  referenceNumber?: string | null;
  remarks?: string | null;
  /** Ledger context for the manual fee model. */
  paidTillDate?: string | null;
  remainingAmount?: string | null;
  /** Legacy ONLINE (Razorpay) records only — never populated for new manual receipts. */
  gatewayPaymentId?: string | null;
};

export function generateReceiptPdf(input: ReceiptPdfInput) {
  const rows: [string, boolean][] = [
    [`Receipt No: ${input.receiptNumber}`, true],
    [`Date/Time: ${input.paidAt}`, true],
    ["", true],
    [`Student: ${input.studentName}`, true],
    [`Admission No: ${input.admissionNo}`, Boolean(input.admissionNo)],
    [`Class/Section: ${input.classSection}`, true],
    [`Fee: ${input.feeTitle}`, true],
    [`Amount Received: ${input.amount}`, true],
    [`Payment Method: ${input.paymentMethod}`, true],
    [`Reference: ${input.referenceNumber}`, Boolean(input.referenceNumber)],
    [`Remarks: ${input.remarks}`, Boolean(input.remarks)],
    ["", Boolean(input.paidTillDate || input.remainingAmount)],
    [`Paid Till Date: ${input.paidTillDate}`, Boolean(input.paidTillDate)],
    [`Remaining Amount: ${input.remainingAmount}`, Boolean(input.remainingAmount)],
    // Gateway id only surfaces for legacy ONLINE historical records.
    [`Gateway Payment ID: ${input.gatewayPaymentId}`, Boolean(input.gatewayPaymentId)],
    ["", true],
    ["This is a computer-generated receipt.", true],
  ];

  const lines: PdfLine[] = [
    { text: input.schoolName, size: 18 },
    { text: "Fee Payment Receipt", size: 14, gapBefore: 6 },
    { text: "", size: 11 },
    ...rows.filter(([, show]) => show).map(([text]) => ({ text, size: 11 })),
  ];

  return renderTextPdf(lines, { lineHeight: 22 });
}
