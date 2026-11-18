-- AlterTable
ALTER TABLE "group_cohort_member" ADD COLUMN     "parentConsentMethod" TEXT,
ADD COLUMN     "parentConsentVerifiedAt" TIMESTAMP(3);
