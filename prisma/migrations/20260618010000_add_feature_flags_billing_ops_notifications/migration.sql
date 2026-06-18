-- CreateEnum
CREATE TYPE "FeatureFlagKey" AS ENUM ('ATTENDANCE', 'HOMEWORK', 'FEES', 'REPORT_CARDS', 'REPORT_CARD_BUILDER', 'MOBILE_APP', 'PARENT_PORTAL', 'STUDENT_PORTAL', 'NOTIFICATIONS', 'ANALYTICS', 'WHITE_LABEL', 'TEACHER_PERMISSIONS', 'AI_FEATURES');

-- CreateEnum
CREATE TYPE "PaymentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCHOOL_REGISTERED', 'PAYMENT_PROOF_SUBMITTED', 'SUBSCRIPTION_EXPIRING', 'INVOICE_OVERDUE');

-- CreateTable
CREATE TABLE "SchoolFeatureFlag" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" "FeatureFlagKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProofSubmission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "billingMonth" DATE NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "transactionRef" TEXT,
    "notes" TEXT,
    "receiptData" TEXT NOT NULL,
    "receiptFileName" TEXT,
    "receiptMimeType" TEXT,
    "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProofSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "planId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "billingPeriodStart" DATE NOT NULL,
    "billingPeriodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FounderNotification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "schoolId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FounderNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolFeatureFlag_schoolId_idx" ON "SchoolFeatureFlag"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeatureFlag_schoolId_key_key" ON "SchoolFeatureFlag"("schoolId", "key");

-- CreateIndex
CREATE INDEX "PaymentProofSubmission_schoolId_status_idx" ON "PaymentProofSubmission"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentProofSubmission_schoolId_idx" ON "PaymentProofSubmission"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_status_idx" ON "Invoice"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_idx" ON "Invoice"("schoolId");

-- CreateIndex
CREATE INDEX "Invoice_planId_idx" ON "Invoice"("planId");

-- CreateIndex
CREATE INDEX "FounderNotification_isRead_createdAt_idx" ON "FounderNotification"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "FounderNotification_schoolId_idx" ON "FounderNotification"("schoolId");

-- AddForeignKey
ALTER TABLE "SchoolFeatureFlag" ADD CONSTRAINT "SchoolFeatureFlag_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProofSubmission" ADD CONSTRAINT "PaymentProofSubmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProofSubmission" ADD CONSTRAINT "PaymentProofSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProofSubmission" ADD CONSTRAINT "PaymentProofSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FounderNotification" ADD CONSTRAINT "FounderNotification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
