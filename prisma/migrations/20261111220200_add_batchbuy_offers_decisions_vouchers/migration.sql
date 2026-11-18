-- CreateEnum
CREATE TYPE "CohortOfferStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'QUORUM_MET', 'SUPERSEDED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OfferDecisionType" AS ENUM ('ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('PENDING_QUORUM', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REDEEMED');

-- CreateTable
CREATE TABLE "cohort_offer" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceSlabId" TEXT,
    "status" "CohortOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "baseFee" DECIMAL(12,2) NOT NULL,
    "registrationFeeOriginal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "waiveRegistration" BOOLEAN NOT NULL DEFAULT true,
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "netPayableTuition" DECIMAL(12,2) NOT NULL,
    "includedPerks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fallbackPolicy" "SlabFallbackPolicy" NOT NULL DEFAULT 'ABSORB_SHORTFALL',
    "paymentTerms" TEXT,
    "additionalNotes" TEXT,
    "minAcceptanceQuorum" INTEGER NOT NULL,
    "minAdmissionQuorum" INTEGER NOT NULL,
    "offerExpiresAt" TIMESTAMP(3) NOT NULL,
    "voucherExpiresAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "quorumMetAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cohort_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_offer_decision" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "cohortMemberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "OfferDecisionType" NOT NULL,
    "declineReason" TEXT,
    "revalidatedIntentAt" TIMESTAMP(3) NOT NULL,
    "guardianConsentVerifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_offer_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_voucher" (
    "id" TEXT NOT NULL,
    "voucherCode" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "securityNonce" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "decisionId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "cohortMemberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'PENDING_QUORUM',
    "baseFee" DECIMAL(12,2) NOT NULL,
    "registrationFeeOriginal" DECIMAL(10,2) NOT NULL,
    "waiveRegistration" BOOLEAN NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "netPayableTuition" DECIMAL(12,2) NOT NULL,
    "includedPerks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fallbackPolicy" "SlabFallbackPolicy" NOT NULL,
    "minAcceptanceQuorumSnapshot" INTEGER NOT NULL,
    "minAdmissionQuorumSnapshot" INTEGER NOT NULL,
    "studentNameSnapshot" TEXT NOT NULL,
    "instituteNameSnapshot" TEXT NOT NULL,
    "batchNameSnapshot" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cohort_offer_cohortId_status_idx" ON "cohort_offer"("cohortId", "status");

-- CreateIndex
CREATE INDEX "cohort_offer_instituteId_status_idx" ON "cohort_offer"("instituteId", "status");

-- CreateIndex
CREATE INDEX "cohort_offer_batchId_idx" ON "cohort_offer"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_offer_cohortId_version_key" ON "cohort_offer"("cohortId", "version");

-- CreateIndex
CREATE INDEX "group_offer_decision_cohortId_decision_idx" ON "group_offer_decision"("cohortId", "decision");

-- CreateIndex
CREATE INDEX "group_offer_decision_userId_idx" ON "group_offer_decision"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_offer_decision_offerId_cohortMemberId_key" ON "group_offer_decision"("offerId", "cohortMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "group_offer_decision_offerId_userId_key" ON "group_offer_decision"("offerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_voucherCode_key" ON "admission_voucher"("voucherCode");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_tokenHash_key" ON "admission_voucher"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_securityNonce_key" ON "admission_voucher"("securityNonce");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_decisionId_key" ON "admission_voucher"("decisionId");

-- CreateIndex
CREATE INDEX "admission_voucher_userId_status_idx" ON "admission_voucher"("userId", "status");

-- CreateIndex
CREATE INDEX "admission_voucher_instituteId_status_idx" ON "admission_voucher"("instituteId", "status");

-- CreateIndex
CREATE INDEX "admission_voucher_cohortId_status_idx" ON "admission_voucher"("cohortId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_offerId_cohortMemberId_key" ON "admission_voucher"("offerId", "cohortMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "admission_voucher_offerId_userId_key" ON "admission_voucher"("offerId", "userId");

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "group_admission_cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "institute_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_sourceSlabId_fkey" FOREIGN KEY ("sourceSlabId") REFERENCES "group_discount_slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_offer" ADD CONSTRAINT "cohort_offer_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_offer_decision" ADD CONSTRAINT "group_offer_decision_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "cohort_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_offer_decision" ADD CONSTRAINT "group_offer_decision_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "group_admission_cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_offer_decision" ADD CONSTRAINT "group_offer_decision_cohortMemberId_fkey" FOREIGN KEY ("cohortMemberId") REFERENCES "group_cohort_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_offer_decision" ADD CONSTRAINT "group_offer_decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "cohort_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "group_offer_decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "group_admission_cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_cohortMemberId_fkey" FOREIGN KEY ("cohortMemberId") REFERENCES "group_cohort_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_voucher" ADD CONSTRAINT "admission_voucher_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "institute_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

