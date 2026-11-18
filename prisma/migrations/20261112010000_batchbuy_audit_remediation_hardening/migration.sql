-- CreateEnum
CREATE TYPE "CommissionCreditNoteStatus" AS ENUM ('ISSUED', 'APPLIED_TO_INVOICE', 'REFUND_PENDING', 'REFUNDED', 'VOID');

-- CreateEnum
CREATE TYPE "CommissionCreditNoteReason" AS ENUM ('COOLING_OFF_CANCELLATION', 'POST_HOLD_CLAWBACK', 'FALLBACK_DECLINED', 'DISPUTE_ADJUSTMENT');

-- AlterEnum
ALTER TYPE "VoucherSettlementState" ADD VALUE 'CANCELLED_AFTER_REDEMPTION';

-- DropForeignKey
ALTER TABLE "batchbuy_audit_log" DROP CONSTRAINT "batchbuy_audit_log_instituteId_fkey";

-- AlterTable
ALTER TABLE "batchbuy_audit_log" ADD COLUMN     "instituteIdSnapshot" TEXT;

-- AlterTable
ALTER TABLE "institute_batchbuy_agreement" ADD COLUMN     "caMembershipNumber" TEXT,
ADD COLUMN     "caValidatedAt" TIMESTAMP(3),
ADD COLUMN     "caValidationDocUrl" TEXT,
ADD COLUMN     "caValidationNote" TEXT,
ADD COLUMN     "caValidatorName" TEXT;

-- CreateTable
CREATE TABLE "batchbuy_credit_note" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "instituteId" TEXT,
    "instituteIdSnapshot" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "commissionEntryId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "reasonType" "CommissionCreditNoteReason" NOT NULL,
    "status" "CommissionCreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "originalLedgerStatus" "CommissionHoldStatus" NOT NULL,
    "originalInvoiceStatus" "CommissionInvoiceStatus" NOT NULL,
    "commissionReversalAmount" DECIMAL(12,2) NOT NULL,
    "cgstReversalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstReversalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstReversalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstReversalTotal" DECIMAL(12,2) NOT NULL,
    "totalCreditAmount" DECIMAL(12,2) NOT NULL,
    "appliedToInvoiceBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundPayableToInstitute" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTreatmentModeUsed" TEXT NOT NULL,
    "sacCodeUsed" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "settledRefundUtr" TEXT,
    "settledRefundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batchbuy_credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_credit_note_creditNoteNumber_key" ON "batchbuy_credit_note"("creditNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_credit_note_idempotencyKey_key" ON "batchbuy_credit_note"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_credit_note_commissionEntryId_key" ON "batchbuy_credit_note"("commissionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_credit_note_settledRefundUtr_key" ON "batchbuy_credit_note"("settledRefundUtr");

-- CreateIndex
CREATE INDEX "batchbuy_credit_note_instituteId_status_idx" ON "batchbuy_credit_note"("instituteId", "status");

-- CreateIndex
CREATE INDEX "batchbuy_credit_note_invoiceId_idx" ON "batchbuy_credit_note"("invoiceId");

-- CreateIndex
CREATE INDEX "batchbuy_credit_note_admissionId_idx" ON "batchbuy_credit_note"("admissionId");

-- AddForeignKey
ALTER TABLE "batchbuy_credit_note" ADD CONSTRAINT "batchbuy_credit_note_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_credit_note" ADD CONSTRAINT "batchbuy_credit_note_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "batchbuy_commission_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_credit_note" ADD CONSTRAINT "batchbuy_credit_note_commissionEntryId_fkey" FOREIGN KEY ("commissionEntryId") REFERENCES "batchbuy_commission_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_credit_note" ADD CONSTRAINT "batchbuy_credit_note_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admission_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_credit_note" ADD CONSTRAINT "batchbuy_credit_note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_audit_log" ADD CONSTRAINT "batchbuy_audit_log_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
