-- Use fixed-precision decimal money values and add online payment metadata.
ALTER TABLE "FeeStructure"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "FeePayment"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING ROUND("amount"::numeric, 2),
  ALTER COLUMN "paidAt" DROP NOT NULL,
  ALTER COLUMN "recordedById" DROP NOT NULL,
  ADD COLUMN "paymentGateway" TEXT,
  ADD COLUMN "gatewayOrderId" TEXT,
  ADD COLUMN "gatewayPaymentId" TEXT,
  ADD COLUMN "gatewaySignature" TEXT,
  ADD COLUMN "receiptNumber" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PAID';

CREATE UNIQUE INDEX "FeePayment_gatewayOrderId_key" ON "FeePayment"("gatewayOrderId");
CREATE UNIQUE INDEX "FeePayment_gatewayPaymentId_key" ON "FeePayment"("gatewayPaymentId");
CREATE UNIQUE INDEX "FeePayment_receiptNumber_key" ON "FeePayment"("receiptNumber");
CREATE INDEX "FeePayment_schoolId_status_idx" ON "FeePayment"("schoolId", "status");
CREATE INDEX "FeePayment_feeStructureId_idx" ON "FeePayment"("feeStructureId");
