import { z } from "zod";

export const SlabFallbackPolicyEnum = z.enum([
  "ABSORB_SHORTFALL",
  "REVERT_TO_LOWER_SLAB",
  "CANCEL_DISCOUNT",
]);

export type SlabFallbackPolicyType = z.infer<typeof SlabFallbackPolicyEnum>;

export const SingleSlabInputSchema = z.object({
  id: z.string().optional(),
  minStudents: z
    .number()
    .int("Minimum students must be an integer")
    .min(2, "Minimum group size must be at least 2 students")
    .max(200, "Minimum group size cannot exceed 200"),
  maxStudents: z
    .number()
    .int("Maximum students must be an integer")
    .min(2, "Maximum group size must be at least 2")
    .max(500, "Maximum group size cannot exceed 500")
    .nullable()
    .optional(),
  discountPercentage: z
    .number()
    .min(0.5, "Discount must be at least 0.5%")
    .max(50.0, "Discount cannot exceed 50.0% to protect institute unit economics"),
  waiveRegistration: z.boolean().default(true),
  includedPerks: z.array(z.string().trim().min(1).max(100)).default([]),
  fallbackPolicy: SlabFallbackPolicyEnum.default("ABSORB_SHORTFALL"),
  notes: z.string().max(500, "Notes cannot exceed 500 characters").nullable().optional(),
  isActive: z.boolean().default(true),
});

export type SingleSlabInput = z.infer<typeof SingleSlabInputSchema>;

export const SaveSlabsInputSchema = z.object({
  instituteId: z.string().min(1, "Institute ID is required"),
  batchId: z.string().nullable().optional(),
  slabs: z.array(SingleSlabInputSchema).min(1, "At least one discount slab is required"),
});

export type SaveSlabsInput = z.infer<typeof SaveSlabsInputSchema>;

/**
 * Validates a list of slabs for range overlaps and discount monotonicity.
 * Throws an Error with a human-readable message if validation fails.
 */
export function validateSlabRangesAndTiers(slabs: SingleSlabInput[]): void {
  // Only validate active slabs
  const activeSlabs = slabs.filter((s) => s.isActive);
  if (activeSlabs.length === 0) {
    throw new Error("At least one active discount slab is required.");
  }

  // 1. Basic validation on individual slabs
  for (const slab of activeSlabs) {
    if (slab.maxStudents !== null && slab.maxStudents !== undefined) {
      if (slab.maxStudents < slab.minStudents) {
        throw new Error(
          `Invalid slab range: Maximum students (${slab.maxStudents}) cannot be less than minimum students (${slab.minStudents}).`
        );
      }
    }
  }

  // 2. Sort by minStudents ascending
  const sorted = [...activeSlabs].sort((a, b) => a.minStudents - b.minStudents);

  // 3. Check for duplicates, overlaps, and open-ended placement
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const currentMax = current.maxStudents ?? Infinity;

    // Check if open-ended slab (maxStudents == null) is not the last slab
    if (current.maxStudents === null || current.maxStudents === undefined) {
      if (i !== sorted.length - 1) {
        throw new Error(
          `Only the highest volume slab (${current.minStudents}+) can be open-ended without an upper limit.`
        );
      }
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const prevMax = prev.maxStudents ?? Infinity;

      // Duplicate minStudents
      if (current.minStudents === prev.minStudents) {
        throw new Error(
          `Duplicate minimum tier: Multiple slabs configured starting at ${current.minStudents} students.`
        );
      }

      // Range overlap check
      if (prevMax >= current.minStudents) {
        const prevLabel = prev.maxStudents ? `${prev.minStudents}–${prev.maxStudents}` : `${prev.minStudents}+`;
        const currLabel = current.maxStudents ? `${current.minStudents}–${current.maxStudents}` : `${current.minStudents}+`;
        throw new Error(
          `Overlapping slab ranges: Slab [${prevLabel}] overlaps with slab [${currLabel}]. Slabs must be mutually exclusive.`
        );
      }

      // Monotonic discount check: Higher volume must offer >= discount
      if (current.discountPercentage < prev.discountPercentage) {
        const prevLabel = prev.maxStudents ? `${prev.minStudents}–${prev.maxStudents}` : `${prev.minStudents}+`;
        const currLabel = current.maxStudents ? `${current.minStudents}–${current.maxStudents}` : `${current.minStudents}+`;
        throw new Error(
          `Contradictory discount: Higher tier [${currLabel}] offers ${current.discountPercentage}%, which is lower than the preceding tier [${prevLabel}] at ${prev.discountPercentage}%. Volume discounts must increase or stay equal as group size grows.`
        );
      }
    }
  }
}
