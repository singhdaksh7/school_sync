export const PAYMENT_PROOF_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type PaymentProofStatusValue = (typeof PAYMENT_PROOF_STATUSES)[number];

export const PAYMENT_PROOF_STATUS_LABEL: Record<PaymentProofStatusValue, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const PAYMENT_PROOF_STATUS_BADGE_VARIANT: Record<
  PaymentProofStatusValue,
  "success" | "warning" | "destructive"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "OVERDUE", "CANCELLED"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatusValue, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

export const INVOICE_STATUS_BADGE_VARIANT: Record<
  InvoiceStatusValue,
  "secondary" | "default" | "success" | "destructive"
> = {
  DRAFT: "secondary",
  ISSUED: "default",
  PAID: "success",
  OVERDUE: "destructive",
  CANCELLED: "secondary",
};
