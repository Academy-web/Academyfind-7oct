-- CreateEnum
CREATE TYPE "TrialSource" AS ENUM ('EMAIL_CAMPAIGN', 'NEW_CLAIM', 'NEW_REQUEST', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('PENDING', 'ACTIVE', 'CONVERTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Institute" ADD COLUMN     "hasUsedTrial" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "institute_trial" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "activatedByUserId" TEXT,
    "source" "TrialSource" NOT NULL,
    "status" "TrialStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "campaignBatchId" TEXT,
    "recipientEmail" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailDeliveredAt" TIMESTAMP(3),
    "emailBouncedAt" TIMESTAMP(3),
    "linkAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "humanClickConfirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "convertedPlan" "SubscriptionPlan",
    "convertedPaymentId" TEXT,
    "expiredAt" TIMESTAMP(3),
    "reminder48hSentAt" TIMESTAMP(3),
    "expiryEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institute_trial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_audit_log" (
    "id" TEXT NOT NULL,
    "trialId" TEXT,
    "instituteId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institute_trial_tokenHash_key" ON "institute_trial"("tokenHash");

-- CreateIndex
CREATE INDEX "institute_trial_instituteId_idx" ON "institute_trial"("instituteId");

-- CreateIndex
CREATE INDEX "institute_trial_status_expiresAt_idx" ON "institute_trial"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "institute_trial_campaignBatchId_idx" ON "institute_trial"("campaignBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "institute_trial_one_active_per_institute" ON "institute_trial"("instituteId") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "institute_trial_one_pending_per_institute" ON "institute_trial"("instituteId") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "trial_audit_log_instituteId_createdAt_idx" ON "trial_audit_log"("instituteId", "createdAt");

-- CreateIndex
CREATE INDEX "trial_audit_log_trialId_idx" ON "trial_audit_log"("trialId");

-- CreateIndex
CREATE INDEX "outbox_event_status_nextRetryAt_idx" ON "outbox_event"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "outbox_event_aggregateId_status_idx" ON "outbox_event"("aggregateId", "status");

-- CreateIndex
CREATE INDEX "webhook_event_status_lockedAt_idx" ON "webhook_event"("status", "lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_provider_providerEventId_key" ON "webhook_event"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "institute_trial" ADD CONSTRAINT "institute_trial_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institute_trial" ADD CONSTRAINT "institute_trial_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_audit_log" ADD CONSTRAINT "trial_audit_log_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "institute_trial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_audit_log" ADD CONSTRAINT "trial_audit_log_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_audit_log" ADD CONSTRAINT "trial_audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
