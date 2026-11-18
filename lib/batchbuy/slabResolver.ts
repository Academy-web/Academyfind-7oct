import { prisma } from "@/lib/prisma";
import { SlabFallbackPolicyType } from "./slabValidation";

export interface EffectiveDiscountSlab {
  id: string;
  instituteId: string;
  batchId: string | null;
  minStudents: number;
  maxStudents: number | null;
  discountPercentage: number;
  waiveRegistration: boolean;
  includedPerks: string[];
  fallbackPolicy: SlabFallbackPolicyType;
  notes: string | null;
}

export interface SlabResolutionResult {
  scope: "BATCH_OVERRIDE" | "INSTITUTE_DEFAULT" | "NONE";
  slabs: EffectiveDiscountSlab[];
}

/**
 * Resolves the active discount slabs applicable to a given institute and optional batch.
 *
 * Precedence Rule:
 * 1. If `batchId` is specified AND the batch has >= 1 active, non-archived override slab,
 *    ONLY those batch-specific slabs apply (full override, no mixing with institute defaults).
 * 2. If no active batch-specific override exists (or `batchId` is omitted),
 *    falls back to active, non-archived institute-wide default slabs (`batchId = null`).
 * 3. If neither exists, returns `scope: "NONE"` with an empty list.
 */
export async function resolveEffectiveDiscountSlabs(
  instituteId: string,
  batchId?: string | null
): Promise<SlabResolutionResult> {
  if (batchId) {
    const batchSlabs = await prisma.groupDiscountSlab.findMany({
      where: {
        instituteId,
        batchId,
        isActive: true,
        isArchived: false,
      },
      orderBy: { minStudents: "asc" },
    });

    if (batchSlabs.length > 0) {
      return {
        scope: "BATCH_OVERRIDE",
        slabs: batchSlabs.map((s) => ({
          id: s.id,
          instituteId: s.instituteId,
          batchId: s.batchId,
          minStudents: s.minStudents,
          maxStudents: s.maxStudents,
          discountPercentage: Number(s.discountPercentage),
          waiveRegistration: s.waiveRegistration,
          includedPerks: s.includedPerks,
          fallbackPolicy: s.fallbackPolicy as SlabFallbackPolicyType,
          notes: s.notes,
        })),
      };
    }
  }

  const instituteDefaults = await prisma.groupDiscountSlab.findMany({
    where: {
      instituteId,
      batchId: null,
      isActive: true,
      isArchived: false,
    },
    orderBy: { minStudents: "asc" },
  });

  if (instituteDefaults.length > 0) {
    return {
      scope: "INSTITUTE_DEFAULT",
      slabs: instituteDefaults.map((s) => ({
        id: s.id,
        instituteId: s.instituteId,
        batchId: s.batchId,
        minStudents: s.minStudents,
        maxStudents: s.maxStudents,
        discountPercentage: Number(s.discountPercentage),
        waiveRegistration: s.waiveRegistration,
        includedPerks: s.includedPerks,
        fallbackPolicy: s.fallbackPolicy as SlabFallbackPolicyType,
        notes: s.notes,
      })),
    };
  }

  return {
    scope: "NONE",
    slabs: [],
  };
}
