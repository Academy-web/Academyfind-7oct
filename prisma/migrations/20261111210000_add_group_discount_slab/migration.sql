-- CreateEnum
CREATE TYPE "SlabFallbackPolicy" AS ENUM ('ABSORB_SHORTFALL', 'REVERT_TO_LOWER_SLAB', 'CANCEL_DISCOUNT');

-- CreateTable
CREATE TABLE "group_discount_slab" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT,
    "minStudents" INTEGER NOT NULL,
    "maxStudents" INTEGER,
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "waiveRegistration" BOOLEAN NOT NULL DEFAULT true,
    "includedPerks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fallbackPolicy" "SlabFallbackPolicy" NOT NULL DEFAULT 'ABSORB_SHORTFALL',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_discount_slab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_discount_slab_instituteId_isActive_isArchived_idx" ON "group_discount_slab"("instituteId", "isActive", "isArchived");

-- CreateIndex
CREATE INDEX "group_discount_slab_batchId_isActive_isArchived_idx" ON "group_discount_slab"("batchId", "isActive", "isArchived");

-- AddForeignKey
ALTER TABLE "group_discount_slab" ADD CONSTRAINT "group_discount_slab_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_discount_slab" ADD CONSTRAINT "group_discount_slab_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "institute_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_discount_slab" ADD CONSTRAINT "group_discount_slab_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_discount_slab" ADD CONSTRAINT "group_discount_slab_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
