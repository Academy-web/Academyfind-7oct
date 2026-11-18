-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('DRAFT', 'FORMING', 'OFFER_PENDING', 'OFFER_ACTIVE', 'ADMISSION_OPEN', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CohortMemberStage" AS ENUM ('INTERESTED', 'INTENT_VERIFIED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'VOUCHER_ISSUED', 'ENROLLED_AT_CENTER', 'DROPPED');

-- CreateTable
CREATE TABLE "group_admission_cohort" (
    "id" TEXT NOT NULL,
    "cohortCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "examCategory" TEXT NOT NULL,
    "targetAcademicYear" INTEGER NOT NULL,
    "targetSize" INTEGER NOT NULL DEFAULT 10,
    "minRequired" INTEGER NOT NULL DEFAULT 5,
    "maxCapacity" INTEGER NOT NULL DEFAULT 25,
    "status" "CohortStatus" NOT NULL DEFAULT 'FORMING',
    "formingExpiresAt" TIMESTAMP(3) NOT NULL,
    "admissionDeadlineAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_admission_cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_cohort_member" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "CohortMemberStage" NOT NULL DEFAULT 'INTERESTED',
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "profileConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "explicitIntentAt" TIMESTAMP(3),
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "parentNotifiedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_cohort_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_admission_cohort_cohortCode_key" ON "group_admission_cohort"("cohortCode");

-- CreateIndex
CREATE UNIQUE INDEX "group_admission_cohort_conversationId_key" ON "group_admission_cohort"("conversationId");

-- CreateIndex
CREATE INDEX "group_admission_cohort_instituteId_status_idx" ON "group_admission_cohort"("instituteId", "status");

-- CreateIndex
CREATE INDEX "group_admission_cohort_batchId_status_idx" ON "group_admission_cohort"("batchId", "status");

-- CreateIndex
CREATE INDEX "group_admission_cohort_examCategory_status_idx" ON "group_admission_cohort"("examCategory", "status");

-- CreateIndex
CREATE INDEX "group_cohort_member_userId_stage_idx" ON "group_cohort_member"("userId", "stage");

-- CreateIndex
CREATE INDEX "group_cohort_member_cohortId_stage_idx" ON "group_cohort_member"("cohortId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "group_cohort_member_cohortId_userId_key" ON "group_cohort_member"("cohortId", "userId");

-- AddForeignKey
ALTER TABLE "group_admission_cohort" ADD CONSTRAINT "group_admission_cohort_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_admission_cohort" ADD CONSTRAINT "group_admission_cohort_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "institute_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_admission_cohort" ADD CONSTRAINT "group_admission_cohort_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_admission_cohort" ADD CONSTRAINT "group_admission_cohort_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_cohort_member" ADD CONSTRAINT "group_cohort_member_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "group_admission_cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_cohort_member" ADD CONSTRAINT "group_cohort_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
