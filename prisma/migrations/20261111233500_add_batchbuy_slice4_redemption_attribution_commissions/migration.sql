-- CreateEnum
CREATE TYPE "AdmissionLifecycleStatus" AS ENUM ('CONFIRMED', 'PENDING_FALLBACK_CONSENT', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "VoucherSettlementState" AS ENUM ('UNSETTLED', 'PROVISIONAL_QUORUM_OPEN', 'SETTLED_FULL_DISCOUNT', 'SETTLED_SHORTFALL_ABSORBED', 'PENDING_STUDENT_FALLBACK_CONSENT', 'SETTLED_FALLBACK_ACCEPTED', 'CANCELLED_ON_SHORTFALL');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BatchBuyRateTier" AS ENUM ('PARTNER_2_PCT', 'STANDARD_3_PCT', 'NON_PARTNER_4_PCT');

-- CreateEnum
CREATE TYPE "AttributionSourceType" AS ENUM ('VOUCHER_REDEMPTION', 'COHORT_LEAD_MATCH', 'BYPASS_RECOVERED');

-- CreateEnum
CREATE TYPE "AttributionVerificationStatus" AS ENUM ('VERIFIED', 'FLAGGED_SUSPECTED_BYPASS', 'CONFIRMED_BYPASS', 'DISPUTED', 'DISMISSED_FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "CommissionHoldStatus" AS ENUM ('HOLD_PERIOD', 'ELIGIBLE', 'INVOICED', 'SETTLED', 'VOIDED_COOLING_OFF', 'CLAWED_BACK', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CommissionInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID');

-- AlterTable
ALTER TABLE "admission_record" ADD COLUMN     "batchBuyLockedFee" DECIMAL(12,2),
ADD COLUMN     "batchBuySettledFee" DECIMAL(12,2),
ADD COLUMN     "batchBuyVoucherId" TEXT,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "directRefundRequiredAmount" DECIMAL(12,2),
ADD COLUMN     "directRefundStatus" TEXT,
ADD COLUMN     "status" "AdmissionLifecycleStatus" NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE "admission_voucher" ADD COLUMN     "disclosedFallbackFee" DECIMAL(12,2),
ADD COLUMN     "fallbackConsentAccepted" BOOLEAN,
ADD COLUMN     "fallbackConsentRequestedAt" TIMESTAMP(3),
ADD COLUMN     "fallbackConsentRespondedAt" TIMESTAMP(3),
ADD COLUMN     "redeemedAt" TIMESTAMP(3),
ADD COLUMN     "redeemedById" TEXT,
ADD COLUMN     "redemptionMethod" TEXT,
ADD COLUMN     "settledTuition" DECIMAL(12,2),
ADD COLUMN     "settlementState" "VoucherSettlementState" NOT NULL DEFAULT 'UNSETTLED',
ADD COLUMN     "shortfallDisclosureAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "cohort_offer" ADD COLUMN     "attributionWindowDaysSnapshot" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "commissionAgreementId" TEXT,
ADD COLUMN     "commissionRatePctSnapshot" DECIMAL(5,2),
ADD COLUMN     "commissionTierSnapshot" "BatchBuyRateTier",
ADD COLUMN     "holdingPeriodDaysSnapshot" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "institute_batchbuy_agreement" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "rateTier" "BatchBuyRateTier" NOT NULL,
    "commissionRatePct" DECIMAL(5,2) NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "gstTreatmentNote" TEXT NOT NULL,
    "sacCode" TEXT,
    "sacValidatedByCa" BOOLEAN NOT NULL DEFAULT false,
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 30,
    "holdingPeriodDays" INTEGER NOT NULL DEFAULT 15,
    "paymentDueDays" INTEGER NOT NULL DEFAULT 15,
    "commissionBaseRule" TEXT NOT NULL DEFAULT 'SETTLED_TUITION_ONLY',
    "cancellationClawbackPolicy" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptedRepresentativeName" TEXT,
    "acceptedDesignation" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institute_batchbuy_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batchbuy_attribution" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "cohortId" TEXT,
    "offerId" TEXT,
    "cohortMemberId" TEXT,
    "userId" TEXT,
    "voucherId" TEXT,
    "admissionId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "sourceType" "AttributionSourceType" NOT NULL,
    "matchStatus" "AttributionVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "attributionWindowDaysUsed" INTEGER NOT NULL DEFAULT 30,
    "evidenceJson" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batchbuy_attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batchbuy_commission_ledger" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "agreementId" TEXT,
    "admissionId" TEXT NOT NULL,
    "voucherId" TEXT,
    "attributionId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "commissionableTuition" DECIMAL(12,2) NOT NULL,
    "excludedNonTuitionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "excludedChargesNote" TEXT,
    "commissionBaseRule" TEXT NOT NULL DEFAULT 'SETTLED_TUITION_ONLY',
    "commissionRatePct" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "totalPayableAmount" DECIMAL(12,2) NOT NULL,
    "status" "CommissionHoldStatus" NOT NULL DEFAULT 'HOLD_PERIOD',
    "redeemedAt" TIMESTAMP(3) NOT NULL,
    "holdEndsAt" TIMESTAMP(3) NOT NULL,
    "maturedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batchbuy_commission_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batchbuy_commission_invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "dueDaysUsed" INTEGER NOT NULL DEFAULT 15,
    "subtotalCommission" DECIMAL(12,2) NOT NULL,
    "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstTotalAmount" DECIMAL(12,2) NOT NULL,
    "totalPayableAmount" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTreatmentMode" TEXT NOT NULL DEFAULT 'PENDING_CA_VALIDATION',
    "sacCodeUsed" TEXT,
    "sacValidationDisclaimer" TEXT,
    "instituteGstinSnapshot" TEXT,
    "academyFindGstin" TEXT,
    "status" "CommissionInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batchbuy_commission_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batchbuy_commission_payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "utrOrReference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batchbuy_commission_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batchbuy_audit_log" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batchbuy_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "institute_batchbuy_agreement_instituteId_status_effectiveFr_idx" ON "institute_batchbuy_agreement"("instituteId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "institute_batchbuy_agreement_instituteId_version_key" ON "institute_batchbuy_agreement"("instituteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_attribution_voucherId_key" ON "batchbuy_attribution"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_attribution_admissionId_key" ON "batchbuy_attribution"("admissionId");

-- CreateIndex
CREATE INDEX "batchbuy_attribution_instituteId_matchStatus_idx" ON "batchbuy_attribution"("instituteId", "matchStatus");

-- CreateIndex
CREATE INDEX "batchbuy_attribution_cohortId_idx" ON "batchbuy_attribution"("cohortId");

-- CreateIndex
CREATE INDEX "batchbuy_attribution_userId_idx" ON "batchbuy_attribution"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_commission_ledger_admissionId_key" ON "batchbuy_commission_ledger"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_commission_ledger_voucherId_key" ON "batchbuy_commission_ledger"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_commission_ledger_attributionId_key" ON "batchbuy_commission_ledger"("attributionId");

-- CreateIndex
CREATE INDEX "batchbuy_commission_ledger_instituteId_status_idx" ON "batchbuy_commission_ledger"("instituteId", "status");

-- CreateIndex
CREATE INDEX "batchbuy_commission_ledger_holdEndsAt_status_idx" ON "batchbuy_commission_ledger"("holdEndsAt", "status");

-- CreateIndex
CREATE INDEX "batchbuy_commission_ledger_invoiceId_idx" ON "batchbuy_commission_ledger"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_commission_invoice_invoiceNumber_key" ON "batchbuy_commission_invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "batchbuy_commission_invoice_instituteId_status_idx" ON "batchbuy_commission_invoice"("instituteId", "status");

-- CreateIndex
CREATE INDEX "batchbuy_commission_invoice_dueAt_status_idx" ON "batchbuy_commission_invoice"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "batchbuy_commission_payment_utrOrReference_key" ON "batchbuy_commission_payment"("utrOrReference");

-- CreateIndex
CREATE INDEX "batchbuy_commission_payment_invoiceId_idx" ON "batchbuy_commission_payment"("invoiceId");

-- CreateIndex
CREATE INDEX "batchbuy_audit_log_instituteId_createdAt_idx" ON "batchbuy_audit_log"("instituteId", "createdAt");

-- CreateIndex
CREATE INDEX "batchbuy_audit_log_entityType_entityId_idx" ON "batchbuy_audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "batchbuy_audit_log_action_createdAt_idx" ON "batchbuy_audit_log"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admission_record_batchBuyVoucherId_key" ON "admission_record"("batchBuyVoucherId");

-- CreateIndex
CREATE INDEX "admission_record_batchId_idx" ON "admission_record"("batchId");

-- CreateIndex
CREATE INDEX "admission_record_status_idx" ON "admission_record"("status");

-- CreateIndex
CREATE INDEX "admission_voucher_offerId_settlementState_idx" ON "admission_voucher"("offerId", "settlementState");

-- AddForeignKey
ALTER TABLE "admission_record" ADD CONSTRAINT "admission_record_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "institute_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_record" ADD CONSTRAINT "admission_record_batchBuyVoucherId_fkey" FOREIGN KEY ("batchBuyVoucherId") REFERENCES "admission_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_commissionAgreementId_fkey" FOREIGN KEY ("commissionAgreementId") REFERENCES "institute_batchbuy_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_batchbuy_agreement" ADD CONSTRAINT "institute_batchbuy_agreement_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_batchbuy_agreement" ADD CONSTRAINT "institute_batchbuy_agreement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_batchbuy_agreement" ADD CONSTRAINT "institute_batchbuy_agreement_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "group_admission_cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "cohort_offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_cohortMemberId_fkey" FOREIGN KEY ("cohortMemberId") REFERENCES "group_cohort_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "admission_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admission_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "institute_enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_attribution" ADD CONSTRAINT "batchbuy_attribution_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "institute_batchbuy_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admission_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "admission_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "batchbuy_attribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_ledger" ADD CONSTRAINT "batchbuy_commission_ledger_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "batchbuy_commission_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_invoice" ADD CONSTRAINT "batchbuy_commission_invoice_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_invoice" ADD CONSTRAINT "batchbuy_commission_invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_payment" ADD CONSTRAINT "batchbuy_commission_payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "batchbuy_commission_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_payment" ADD CONSTRAINT "batchbuy_commission_payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_commission_payment" ADD CONSTRAINT "batchbuy_commission_payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_audit_log" ADD CONSTRAINT "batchbuy_audit_log_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batchbuy_audit_log" ADD CONSTRAINT "batchbuy_audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
