"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { writeBatchBuyAuditLogTx } from "./redemptionAuth";
import {
  SaveSlabsInput,
  SaveSlabsInputSchema,
  validateSlabRangesAndTiers,
  SlabFallbackPolicyType,
  SingleSlabInput,
} from "./slabValidation";

/**
 * Validates that the current authenticated user has commercial manager or admin rights
 * for the requested institute.
 *
 * Reconciled with existing manager architecture (`batches/actions.ts`, `members/actions.ts`,
 * and `manager/[instituteId]/layout.tsx`):
 * - Platform `ADMIN` is authorized.
 * - `InstituteManager` record owners/managers are authorized.
 * - Active `InstituteMembership` with role `MANAGER` or `ADMIN` is authorized.
 * - `SALES_MANAGER` / `INSTITUTE_SALES_MANAGER` are deliberately excluded from altering
 *   commercial discount slabs and cohort offers across Slice 1 & Slice 3 (their scope
 *   is lead follow-ups and counter verification unless explicitly delegated).
 */
export async function verifyInstituteManagerAccess(instituteId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { authorized: false, error: "Authentication required. Please log in.", userId: null };
  }

  const userId = session.user.id;

  // 1. Platform Admin always has access
  if (session.user.role === "ADMIN") {
    return { authorized: true, error: null, userId };
  }

  // 2. Check InstituteManager record (consistent with manager/[instituteId]/layout.tsx)
  const isManager = await prisma.instituteManager.findUnique({
    where: {
      userId_instituteId: {
        userId,
        instituteId,
      },
    },
  });

  if (isManager) {
    return { authorized: true, error: null, userId };
  }

  // 3. Check active InstituteMembership role (MANAGER or ADMIN only)
  const membership = await prisma.instituteMembership.findFirst({
    where: {
      userId,
      instituteId,
      status: "ACTIVE",
      isActive: true,
      role: { in: ["MANAGER", "ADMIN"] },
    },
  });

  if (membership) {
    return { authorized: true, error: null, userId };
  }

  return {
    authorized: false,
    error: "Access denied. Only Institute Managers or Admins can configure BatchBuy discount slabs.",
    userId,
  };
}

export interface SerializedDiscountSlab {
  id: string;
  instituteId: string;
  batchId: string | null;
  batchName?: string | null;
  minStudents: number;
  maxStudents: number | null;
  discountPercentage: number;
  waiveRegistration: boolean;
  includedPerks: string[];
  fallbackPolicy: SlabFallbackPolicyType;
  notes: string | null;
  isActive: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetches all non-archived discount slabs for an institute,
 * along with available batches for batch-specific overrides.
 */
export async function getInstituteDiscountSlabs(
  instituteId: string,
  batchId?: string | null
) {
  const { authorized, error } = await verifyInstituteManagerAccess(instituteId);
  if (!authorized) {
    return { success: false, error, slabs: [], batches: [] };
  }

  try {
    const batches = await prisma.instituteBatch.findMany({
      where: { instituteId, isActive: true },
      select: {
        id: true,
        name: true,
        courseName: true,
        academicYear: true,
        fee: true,
      },
      orderBy: { name: "asc" },
    });

    const whereClause: Prisma.GroupDiscountSlabWhereInput = {
      instituteId,
      isArchived: false,
    };

    if (batchId !== undefined) {
      whereClause.batchId = batchId;
    }

    const rawSlabs = await prisma.groupDiscountSlab.findMany({
      where: whereClause,
      include: {
        batch: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ batchId: "asc" }, { minStudents: "asc" }],
    });

    const slabs: SerializedDiscountSlab[] = rawSlabs.map((s) => ({
      id: s.id,
      instituteId: s.instituteId,
      batchId: s.batchId,
      batchName: s.batch?.name || null,
      minStudents: s.minStudents,
      maxStudents: s.maxStudents,
      discountPercentage: Number(s.discountPercentage),
      waiveRegistration: s.waiveRegistration,
      includedPerks: s.includedPerks,
      fallbackPolicy: s.fallbackPolicy as SlabFallbackPolicyType,
      notes: s.notes,
      isActive: s.isActive,
      isArchived: s.isArchived,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));

    return { success: true, error: null, slabs, batches };
  } catch (err: unknown) {
    console.error("Failed to load discount slabs:", err);
    return {
      success: false,
      error: "Unable to retrieve discount slabs at this time.",
      slabs: [],
      batches: [],
    };
  }
}

/**
 * Helper to validate active DB rows inside a transaction post-write.
 */
function assertPersistedSlabsInvariant(
  rows: Array<{
    id: string;
    minStudents: number;
    maxStudents: number | null;
    discountPercentage: Prisma.Decimal;
    waiveRegistration: boolean;
    includedPerks: string[];
    fallbackPolicy: string;
    notes: string | null;
    isActive: boolean;
  }>
) {
  const mapped: SingleSlabInput[] = rows.map((r) => ({
    id: r.id,
    minStudents: r.minStudents,
    maxStudents: r.maxStudents,
    discountPercentage: Number(r.discountPercentage),
    waiveRegistration: r.waiveRegistration,
    includedPerks: r.includedPerks,
    fallbackPolicy: r.fallbackPolicy as SlabFallbackPolicyType,
    notes: r.notes,
    isActive: r.isActive,
  }));
  validateSlabRangesAndTiers(mapped);
}

/**
 * Saves (creates/updates/archives) discount slabs for a given scope
 * (either institute-wide or batch-specific).
 * Uses Serializable transaction + row-level FOR UPDATE lock to prevent
 * concurrent overlapping or contradictory configurations.
 */
export async function saveInstituteDiscountSlabs(rawInput: SaveSlabsInput) {
  // 1. Validate Zod Schema
  const parseResult = SaveSlabsInputSchema.safeParse(rawInput);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((e: { message: string }) => e.message).join(". ");
    return { success: false, error: errorMsg };
  }

  const { instituteId, batchId, slabs } = parseResult.data;

  // 2. Verify authorization
  const { authorized, error: authError, userId } = await verifyInstituteManagerAccess(instituteId);
  if (!authorized || !userId) {
    return { success: false, error: authError || "Unauthorized" };
  }

  // 3. If batchId is provided, verify it belongs to this institute
  if (batchId) {
    const batch = await prisma.instituteBatch.findFirst({
      where: { id: batchId, instituteId },
    });
    if (!batch) {
      return { success: false, error: "The selected batch does not exist for this institute." };
    }
  }

  // 4. Pre-transaction range logic, overlaps, and discount monotonicity validation
  try {
    validateSlabRangesAndTiers(slabs);
  } catch (validationErr: unknown) {
    const message = validationErr instanceof Error ? validationErr.message : "Slab validation failed.";
    return { success: false, error: message };
  }

  try {
    // 5. Execute Serializable transaction with row-level lock on parent Institute
    await prisma.$transaction(
      async (tx) => {
        const scopeBatchId = batchId || null;

        // Lock the parent institute row to serialize concurrent slab edits for this institute
        await tx.$queryRaw`SELECT id FROM "Institute" WHERE id = ${instituteId} FOR UPDATE`;

        // Existing non-archived slabs in this exact scope
        const existingSlabs = await tx.groupDiscountSlab.findMany({
          where: {
            instituteId,
            batchId: scopeBatchId,
            isArchived: false,
          },
        });

        const existingIdSet = new Set(existingSlabs.map((s) => s.id));
        const incomingIds = new Set(slabs.filter((s) => s.id).map((s) => s.id!));

        // IDOR Guard: reject any incoming ID that doesn't belong to this institute & scope
        for (const id of incomingIds) {
          if (!existingIdSet.has(id)) {
            throw new Error(`Invalid or unauthorized slab reference (${id}) for this scope.`);
          }
        }

        // Soft-archive slabs that were removed from the incoming configuration
        const slabsToArchive = existingSlabs.filter((s) => !incomingIds.has(s.id));
        for (const slab of slabsToArchive) {
          await tx.groupDiscountSlab.update({
            where: { id: slab.id },
            data: {
              isArchived: true,
              isActive: false,
              updatedById: userId,
            },
          });
        }

        // Upsert incoming slabs
        for (const slab of slabs) {
          const discountDecimal = new Prisma.Decimal(slab.discountPercentage.toFixed(2));

          if (slab.id) {
            await tx.groupDiscountSlab.update({
              where: { id: slab.id },
              data: {
                minStudents: slab.minStudents,
                maxStudents: slab.maxStudents || null,
                discountPercentage: discountDecimal,
                waiveRegistration: slab.waiveRegistration,
                includedPerks: slab.includedPerks,
                fallbackPolicy: slab.fallbackPolicy,
                notes: slab.notes || null,
                isActive: slab.isActive,
                updatedById: userId,
              },
            });
          } else {
            await tx.groupDiscountSlab.create({
              data: {
                instituteId,
                batchId: scopeBatchId,
                minStudents: slab.minStudents,
                maxStudents: slab.maxStudents || null,
                discountPercentage: discountDecimal,
                waiveRegistration: slab.waiveRegistration,
                includedPerks: slab.includedPerks,
                fallbackPolicy: slab.fallbackPolicy,
                notes: slab.notes || null,
                isActive: slab.isActive,
                isArchived: false,
                createdById: userId,
                updatedById: userId,
              },
            });
          }
        }

        // Post-write invariant assertion on persisted active slabs
        const persistedActive = await tx.groupDiscountSlab.findMany({
          where: {
            instituteId,
            batchId: scopeBatchId,
            isArchived: false,
            isActive: true,
          },
        });
        assertPersistedSlabsInvariant(persistedActive);

        await writeBatchBuyAuditLogTx(tx, {
          instituteId,
          actorUserId: userId,
          actorRole: "INSTITUTE_MANAGER",
          action: "SLABS_SAVED",
          entityType: "GroupDiscountSlab",
          entityId: scopeBatchId ?? instituteId,
          afterState: {
            scopeBatchId,
            slabCount: persistedActive.length,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    // Revalidate affected paths
    revalidatePath(`/manager/${instituteId}/batchbuy/slabs`);
    revalidatePath(`/manager/${instituteId}/batches`);
    revalidatePath(`/manager/${instituteId}`);

    return {
      success: true,
      message: "BatchBuy discount slabs configured and saved successfully.",
    };
  } catch (dbErr: unknown) {
    console.error("Failed to save discount slabs:", dbErr);
    if (
      dbErr instanceof Prisma.PrismaClientKnownRequestError &&
      dbErr.code === "P2034"
    ) {
      return {
        success: false,
        error: "Concurrent edit detected by another manager. Please refresh and try again.",
      };
    }
    const msg =
      dbErr instanceof Error
        ? dbErr.message
        : "An unexpected database error occurred while saving discount slabs.";
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Toggles a single slab's active status inside a Serializable transaction,
 * verifying that re-activating a slab does not create overlaps or contradictory tiers.
 */
export async function toggleDiscountSlabStatus(
  instituteId: string,
  slabId: string,
  isActive: boolean
) {
  const { authorized, error, userId } = await verifyInstituteManagerAccess(instituteId);
  if (!authorized || !userId) {
    return { success: false, error: error || "Unauthorized" };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Institute" WHERE id = ${instituteId} FOR UPDATE`;

        const slab = await tx.groupDiscountSlab.findFirst({
          where: { id: slabId, instituteId, isArchived: false },
        });

        if (!slab) {
          throw new Error("Slab not found or already archived.");
        }

        await tx.groupDiscountSlab.update({
          where: { id: slabId },
          data: {
            isActive,
            updatedById: userId,
          },
        });

        // Verify post-toggle active invariant in this scope
        const activeInScope = await tx.groupDiscountSlab.findMany({
          where: {
            instituteId,
            batchId: slab.batchId,
            isArchived: false,
            isActive: true,
          },
        });

        if (activeInScope.length > 0) {
          assertPersistedSlabsInvariant(activeInScope);
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId,
          actorUserId: userId,
          actorRole: "INSTITUTE_MANAGER",
          action: "SLAB_STATUS_TOGGLED",
          entityType: "GroupDiscountSlab",
          entityId: slabId,
          beforeState: { isActive: slab.isActive, batchId: slab.batchId },
          afterState: { isActive, batchId: slab.batchId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    revalidatePath(`/manager/${instituteId}/batchbuy/slabs`);
    return {
      success: true,
      message: `Slab ${isActive ? "activated" : "deactivated"} successfully.`,
    };
  } catch (err: unknown) {
    console.error("Toggle slab error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update slab status.";
    return { success: false, error: msg };
  }
}

/**
 * Soft-archives a single slab with ownership verification.
 */
export async function archiveDiscountSlab(instituteId: string, slabId: string) {
  const { authorized, error, userId } = await verifyInstituteManagerAccess(instituteId);
  if (!authorized || !userId) {
    return { success: false, error: error || "Unauthorized" };
  }

  try {
    const archived = await prisma.$transaction(async (tx) => {
      const slab = await tx.groupDiscountSlab.findFirst({
        where: { id: slabId, instituteId, isArchived: false },
      });

      if (!slab) {
        return null;
      }

      await tx.groupDiscountSlab.update({
        where: { id: slabId },
        data: {
          isArchived: true,
          isActive: false,
          updatedById: userId,
        },
      });

      await writeBatchBuyAuditLogTx(tx, {
        instituteId,
        actorUserId: userId,
        actorRole: "INSTITUTE_MANAGER",
        action: "SLAB_ARCHIVED",
        entityType: "GroupDiscountSlab",
        entityId: slabId,
        beforeState: { isArchived: false, isActive: slab.isActive, batchId: slab.batchId },
        afterState: { isArchived: true, isActive: false, batchId: slab.batchId },
      });

      return slab;
    });

    if (!archived) {
      return { success: false, error: "Slab not found for this institute." };
    }

    revalidatePath(`/manager/${instituteId}/batchbuy/slabs`);
    return { success: true, message: "Slab archived successfully." };
  } catch (err: unknown) {
    console.error("Archive slab error:", err);
    return { success: false, error: "Failed to archive slab." };
  }
}
