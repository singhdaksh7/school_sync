-- Preserve existing fee-payment history and gateway fields; add a structured
-- manual-ledger reference number for externally collected payments.
ALTER TABLE "FeePayment"
ADD COLUMN "referenceNumber" TEXT;
