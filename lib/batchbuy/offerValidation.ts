import { z } from "zod";
import { SlabFallbackPolicyEnum, type SlabFallbackPolicyType } from "./slabValidation";

export const CohortOfferStatusEnum = z.enum([
  "DRAFT",
  "PUBLISHED",
  "QUORUM_MET",
  "SUPERSEDED",
  "EXPIRED",
  "WITHDRAWN",
]);

export type CohortOfferStatusType = z.infer<typeof CohortOfferStatusEnum>;

export const OfferDecisionTypeEnum = z.enum(["ACCEPTED", "DECLINED"]);
export type OfferDecisionTypeValue = z.infer<typeof OfferDecisionTypeEnum>;

export const VoucherStatusEnum = z.enum([
  "PENDING_QUORUM",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "REDEEMED",
]);
export type VoucherStatusType = z.infer<typeof VoucherStatusEnum>;

export const SaveCohortOfferSchema = z.object({
  offerId: z.string().min(1).optional().nullable(), // Allowed only when updating an existing DRAFT
  cohortId: z.string().min(1, "Cohort ID is required."),
  sourceSlabId: z.string().optional().nullable(),
  title: z
    .string()
    .trim()
    .min(4, "Offer title must be at least 4 characters.")
    .max(140, "Offer title cannot exceed 140 characters."),
  baseFee: z
    .number()
    .finite("Base fee must be a valid number.")
    .positive("Listed tuition base fee must be greater than ₹0.")
    .max(2500000, "Base fee cannot exceed ₹25,00,000."),
  registrationFeeOriginal: z
    .number()
    .finite()
    .min(0, "Registration fee cannot be negative.")
    .max(200000, "Registration fee cannot exceed ₹2,00,000.")
    .default(0),
  waiveRegistration: z.boolean().default(true),
  discountPercentage: z
    .number()
    .finite()
    .min(0.5, "Group discount must be at least 0.5%.")
    .max(50.0, "Group discount cannot exceed 50.0% to protect institute unit economics."),
  includedPerks: z
    .array(z.string().trim().min(2).max(120))
    .max(12, "At most 12 perks can be included per offer.")
    .default([]),
  fallbackPolicy: SlabFallbackPolicyEnum.default("ABSORB_SHORTFALL"),
  minAcceptanceQuorum: z
    .number()
    .int("Acceptance quorum must be a whole number of students.")
    .min(1, "Minimum acceptance quorum must be at least 1 student.")
    .max(100, "Minimum acceptance quorum cannot exceed 100."),
  minAdmissionQuorum: z
    .number()
    .int("Admission quorum must be a whole number of students.")
    .min(1, "Minimum admission quorum must be at least 1 student.")
    .max(100, "Minimum admission quorum cannot exceed 100."),
  offerExpiresAt: z.string().min(1, "Offer acceptance deadline is required."),
  voucherExpiresAt: z.string().min(1, "Voucher validity deadline is required."),
  paymentTerms: z
    .string()
    .trim()
    .max(1000, "Payment terms cannot exceed 1000 characters.")
    .optional()
    .nullable(),
  additionalNotes: z
    .string()
    .trim()
    .max(1000, "Additional notes cannot exceed 1000 characters.")
    .optional()
    .nullable(),
  publishImmediately: z.boolean().default(false),
});

export type SaveCohortOfferInput = z.infer<typeof SaveCohortOfferSchema>;

export const RespondToOfferSchema = z.object({
  cohortId: z.string().min(1, "Cohort ID is required."),
  offerId: z.string().min(1, "Offer ID is required."),
  decision: OfferDecisionTypeEnum,
  declineReason: z
    .string()
    .trim()
    .max(500, "Decline reason cannot exceed 500 characters.")
    .optional()
    .nullable(),
});

export type RespondToOfferInput = z.infer<typeof RespondToOfferSchema>;

export const VerifyGuardianConsentSchema = z.object({
  cohortId: z.string().min(1, "Cohort ID is required."),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Please enter the 6-digit verification code sent to the guardian."),
  guardianConfirmationAccepted: z.boolean().refine((v) => v === true, {
    message:
      "Guardian confirmation acknowledgement is required to verify minor consent.",
  }),
});

export interface OfferFeeBreakdown {
  baseFee: number;
  baseFeeStr: string;
  registrationFeeOriginal: number;
  registrationFeeOriginalStr: string;
  waiveRegistration: boolean;
  discountPercentage: number;
  discountPercentageStr: string;
  discountAmount: number;
  discountAmountStr: string;
  netPayableTuition: number;
  netPayableTuitionStr: string;
  registrationSaved: number;
  totalSavings: number;
}

/**
 * Computes exact paise-accurate fee breakdowns formatted as fixed 2-decimal strings
 * for Prisma `Decimal` storage alongside numeric convenience fields.
 */
export function computeOfferFeeBreakdown(params: {
  baseFee: number;
  registrationFeeOriginal: number;
  waiveRegistration: boolean;
  discountPercentage: number;
}): OfferFeeBreakdown {
  const baseFeePaise = Math.round(params.baseFee * 100);
  const regFeePaise = Math.round(params.registrationFeeOriginal * 100);
  const discountBps = Math.round(params.discountPercentage * 100); // e.g., 12.50% -> 1250 bps

  const discountAmountPaise = Math.round((baseFeePaise * discountBps) / 10000);
  const netPayablePaise = Math.max(0, baseFeePaise - discountAmountPaise);
  const regSavedPaise = params.waiveRegistration ? regFeePaise : 0;
  const totalSavingsPaise = discountAmountPaise + regSavedPaise;

  const toRupees = (paise: number) => paise / 100;
  const toDecimalStr = (paise: number) => (paise / 100).toFixed(2);

  return {
    baseFee: toRupees(baseFeePaise),
    baseFeeStr: toDecimalStr(baseFeePaise),
    registrationFeeOriginal: toRupees(regFeePaise),
    registrationFeeOriginalStr: toDecimalStr(regFeePaise),
    waiveRegistration: params.waiveRegistration,
    discountPercentage: discountBps / 100,
    discountPercentageStr: (discountBps / 100).toFixed(2),
    discountAmount: toRupees(discountAmountPaise),
    discountAmountStr: toDecimalStr(discountAmountPaise),
    netPayableTuition: toRupees(netPayablePaise),
    netPayableTuitionStr: toDecimalStr(netPayablePaise),
    registrationSaved: toRupees(regSavedPaise),
    totalSavings: toRupees(totalSavingsPaise),
  };
}

/**
 * Enforces cross-field invariants for dual quorums and offer/voucher deadlines.
 */
export function validateOfferQuorumsAndDates(params: {
  minAcceptanceQuorum: number;
  minAdmissionQuorum: number;
  cohortMaxCapacity: number;
  offerExpiresAtRaw: string;
  voucherExpiresAtRaw: string;
  now?: Date;
}): {
  offerExpiresAt: Date;
  voucherExpiresAt: Date;
} {
  const now = params.now ?? new Date();

  if (params.minAcceptanceQuorum > params.cohortMaxCapacity) {
    throw new Error(
      `Acceptance quorum (${params.minAcceptanceQuorum}) cannot exceed the cohort maximum capacity (${params.cohortMaxCapacity}).`
    );
  }

  if (params.minAdmissionQuorum > params.minAcceptanceQuorum) {
    throw new Error(
      `Center admission quorum (${params.minAdmissionQuorum}) cannot exceed the acceptance quorum (${params.minAcceptanceQuorum}).`
    );
  }

  const offerExpiresAt = new Date(params.offerExpiresAtRaw);
  const voucherExpiresAt = new Date(params.voucherExpiresAtRaw);

  if (Number.isNaN(offerExpiresAt.getTime())) {
    throw new Error("Invalid offer acceptance deadline.");
  }
  if (Number.isNaN(voucherExpiresAt.getTime())) {
    throw new Error("Invalid voucher validity deadline.");
  }

  const oneHourFromNow = new Date(now.getTime() + 55 * 60 * 1000); // allow small UI clock skew around 1h
  if (offerExpiresAt <= oneHourFromNow) {
    throw new Error(
      "Offer acceptance deadline must be at least 1 hour in the future."
    );
  }

  const maxOfferWindow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  if (offerExpiresAt > maxOfferWindow) {
    throw new Error(
      "Offer acceptance deadline cannot be more than 60 days ahead."
    );
  }

  if (voucherExpiresAt < offerExpiresAt) {
    throw new Error(
      "Voucher redemption deadline must be on or after the offer acceptance deadline."
    );
  }

  const maxVoucherWindow = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  if (voucherExpiresAt > maxVoucherWindow) {
    throw new Error(
      "Voucher redemption deadline cannot be more than 180 days ahead."
    );
  }

  return { offerExpiresAt, voucherExpiresAt };
}

export interface VoucherRedemptionEligibility {
  isRedeemable: boolean;
  effectiveStatus: VoucherStatusType;
  reason: string;
}

/**
 * Evaluates authoritative voucher redemption eligibility and effective status
 * factoring in live clock expiry alongside quorum activation.
 */
export function evaluateVoucherEligibility(params: {
  status: VoucherStatusType;
  offerStatus: CohortOfferStatusType;
  expiresAt: Date;
  offerExpiresAt?: Date | null;
  minAcceptanceQuorum: number;
  acceptedCount: number;
  now?: Date;
}): VoucherRedemptionEligibility {
  const now = params.now ?? new Date();

  if (params.status === "REDEEMED") {
    return {
      isRedeemable: false,
      effectiveStatus: "REDEEMED",
      reason: "This voucher has already been redeemed for admission.",
    };
  }

  if (params.status === "REVOKED" || params.offerStatus === "SUPERSEDED" || params.offerStatus === "WITHDRAWN") {
    return {
      isRedeemable: false,
      effectiveStatus: "REVOKED",
      reason: "This voucher was revoked because the offer was superseded or withdrawn.",
    };
  }

  const offerWindowClosedWithoutQuorum =
    params.status === "PENDING_QUORUM" &&
    (params.offerStatus === "EXPIRED" ||
      (params.offerStatus === "PUBLISHED" &&
        Boolean(params.offerExpiresAt && params.offerExpiresAt <= now)));

  if (params.status === "EXPIRED" || params.expiresAt <= now || offerWindowClosedWithoutQuorum) {
    return {
      isRedeemable: false,
      effectiveStatus: "EXPIRED",
      reason: offerWindowClosedWithoutQuorum
        ? "This pending voucher expired because the offer failed to reach acceptance quorum before the deadline."
        : "This voucher has passed its redemption validity deadline.",
    };
  }

  if (
    params.status === "PENDING_QUORUM" ||
    params.offerStatus === "PUBLISHED" ||
    params.acceptedCount < params.minAcceptanceQuorum
  ) {
    const remaining = Math.max(0, params.minAcceptanceQuorum - params.acceptedCount);
    return {
      isRedeemable: false,
      effectiveStatus: "PENDING_QUORUM",
      reason:
        remaining > 0
          ? `Waiting for ${remaining} more student acceptance${remaining === 1 ? "" : "s"} to unlock acceptance quorum (${params.acceptedCount}/${params.minAcceptanceQuorum}).`
          : "Pending acceptance quorum activation.",
    };
  }

  if (params.status === "ACTIVE" && params.offerStatus === "QUORUM_MET") {
    return {
      isRedeemable: true,
      effectiveStatus: "ACTIVE",
      reason: "Eligible for direct admission verification at the institute center.",
    };
  }

  return {
    isRedeemable: false,
    effectiveStatus: params.status,
    reason: "Voucher is not currently redeemable.",
  };
}

export interface SerializedCohortOfferSummary {
  id: string;
  cohortId: string;
  version: number;
  status: CohortOfferStatusType;
  effectiveStatus: CohortOfferStatusType;
  sourceSlabId: string | null;
  title: string;
  baseFee: number;
  registrationFeeOriginal: number;
  waiveRegistration: boolean;
  discountPercentage: number;
  discountAmount: number;
  netPayableTuition: number;
  totalSavings: number;
  includedPerks: string[];
  fallbackPolicy: SlabFallbackPolicyType;
  paymentTerms: string | null;
  additionalNotes: string | null;
  minAcceptanceQuorum: number;
  minAdmissionQuorum: number;
  acceptedCount: number;
  declinedCount: number;
  activeVoucherCount: number;
  pendingQuorumVoucherCount: number;
  offerExpiresAt: string;
  voucherExpiresAt: string;
  publishedAt: string | null;
  quorumMetAt: string | null;
}
