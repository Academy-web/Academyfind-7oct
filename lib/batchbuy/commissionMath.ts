import { z } from "zod";
import { SlabFallbackPolicyEnum, type SlabFallbackPolicyType } from "./slabValidation";

export const BatchBuyRateTierEnum = z.enum([
  "PARTNER_2_PCT",
  "STANDARD_3_PCT",
  "NON_PARTNER_4_PCT",
]);
export type BatchBuyRateTierType = z.infer<typeof BatchBuyRateTierEnum>;

export const RATE_TIER_PERCENTAGE_MAP: Record<BatchBuyRateTierType, string> = {
  PARTNER_2_PCT: "2.00",
  STANDARD_3_PCT: "3.00",
  NON_PARTNER_4_PCT: "4.00",
};

export const TaxTreatmentModeEnum = z.enum([
  "PENDING_CA_VALIDATION",
  "INTRA_STATE_CGST_SGST",
  "INTER_STATE_IGST",
]);
export type TaxTreatmentModeType = z.infer<typeof TaxTreatmentModeEnum>;

export const SaveInstituteAgreementSchema = z
  .object({
    instituteId: z.string().min(1, "Institute ID is required."),
    rateTier: BatchBuyRateTierEnum,
    gstRatePct: z.coerce.number().min(0).max(28).default(18),
    gstTreatmentNote: z
      .string()
      .trim()
      .min(10, "GST and tax validation notes must be clearly documented.")
      .max(1000),
    sacCode: z.string().trim().max(16).optional().nullable(),
    sacValidatedByCa: z.boolean().default(false),
    caValidatorName: z.string().trim().max(120).optional().nullable(),
    caMembershipNumber: z.string().trim().max(20).optional().nullable(),
    caValidationNote: z.string().trim().max(1000).optional().nullable(),
    caValidationDocUrl: z.string().trim().max(500).optional().nullable(),
    attributionWindowDays: z.coerce.number().int().min(7).max(90).default(30),
    holdingPeriodDays: z.coerce
      .number()
      .int()
      .min(15, "AcademyFind commercial cooling-off hold must be at least 15 days.")
      .max(45)
      .default(15),
    paymentDueDays: z.coerce.number().int().min(7).max(60).default(15),
    cancellationClawbackPolicy: z
      .string()
      .trim()
      .min(10, "Cancellation and clawback terms are required.")
      .max(1500),
    effectiveFrom: z.string().min(1, "Effective start date is required."),
    effectiveTo: z.string().optional().nullable(),
    activateImmediately: z.boolean().default(false),
    acceptedRepresentativeName: z.string().trim().max(120).optional().nullable(),
    acceptedDesignation: z.string().trim().max(120).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.sacValidatedByCa) {
      const sac = val.sacCode?.trim() || "";
      if (!/^\d{6}$/.test(sac)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sacCode"],
          message: "CA sign-off requires a verified 6-digit SAC code (e.g., 998399).",
        });
      }
      if (!val.caValidatorName || val.caValidatorName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["caValidatorName"],
          message: "CA validator full name is required when marking SAC as CA-validated.",
        });
      }
      const icai = val.caMembershipNumber?.trim() || "";
      if (!/^\d{6}$/.test(icai)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["caMembershipNumber"],
          message: "CA validation requires a valid 6-digit ICAI membership number.",
        });
      }
    }
  });
export type SaveInstituteAgreementInput = z.infer<typeof SaveInstituteAgreementSchema>;

export const AcceptInstituteAgreementSchema = z.object({
  agreementId: z.string().min(1),
  acceptedRepresentativeName: z.string().trim().min(2, "Representative name is required.").max(120),
  acceptedDesignation: z.string().trim().min(2, "Representative designation is required.").max(120),
});

export const PreviewVoucherRedemptionSchema = z.object({
  instituteId: z.string().min(1),
  qrPayloadOrCode: z.string().trim().min(4, "Scan QR payload or enter voucher code."),
});

export const RedeemVoucherSchema = z.object({
  instituteId: z.string().min(1),
  qrPayloadOrCode: z.string().trim().min(4, "Scan QR payload or enter voucher code."),
  redemptionMethod: z.enum(["QR_SCAN", "MANUAL_CODE"]).default("MANUAL_CODE"),
  upfrontDirectPaid: z.coerce.number().min(0, "Direct payment cannot be negative.").default(0),
  excludedNonTuitionAmount: z.coerce
    .number()
    .min(0, "Excluded non-tuition charges cannot be negative.")
    .default(0),
  excludedChargesNote: z.string().trim().max(400).optional().nullable(),
  shortfallDisclosureAccepted: z.boolean().default(false),
  admissionNote: z.string().trim().max(600).optional().nullable(),
  paymentModeNote: z.string().trim().max(200).optional().nullable(),
});
export type RedeemVoucherInput = z.infer<typeof RedeemVoucherSchema>;

export const RespondFallbackAdjustmentSchema = z.object({
  voucherId: z.string().min(1),
  acceptFallbackPrice: z.boolean(),
  note: z.string().trim().max(400).optional().nullable(),
});

export const CancelBatchBuyAdmissionSchema = z.object({
  admissionId: z.string().min(1),
  reason: z.string().trim().min(5, "Cancellation reason is required.").max(800),
  directRefundRequiredAmount: z.coerce.number().min(0).optional().nullable(),
  directRefundCompleted: z.boolean().default(false),
});

export const ReviewFlaggedAttributionSchema = z.object({
  attributionId: z.string().min(1),
  decision: z.enum(["CONFIRMED_BYPASS", "DISMISSED_FALSE_POSITIVE"]),
  reviewNote: z.string().trim().min(5, "Review justification is required.").max(800),
});

export const GenerateCommissionInvoiceSchema = z.object({
  instituteId: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  taxTreatmentMode: TaxTreatmentModeEnum.default("PENDING_CA_VALIDATION"),
  sacCodeOverride: z.string().trim().max(16).optional().nullable(),
  instituteGstin: z.string().trim().max(20).optional().nullable(),
  academyFindGstin: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
  issueImmediately: z.boolean().default(false),
});

export const RecordCommissionPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("Payment amount must be greater than zero."),
  paymentMode: z.enum(["NEFT", "RTGS", "IMPS", "UPI_B2B", "RAZORPAY_B2B_LINK", "CHEQUE"]),
  utrOrReference: z.string().trim().min(4, "UTR / payment reference is required.").max(80),
  paidAt: z.string().optional().nullable(),
  note: z.string().trim().max(400).optional().nullable(),
});

export const SettleCreditNoteRefundSchema = z.object({
  creditNoteId: z.string().min(1),
  utrOrReference: z.string().trim().min(4, "Refund UTR / bank reference is required.").max(80),
  settledAt: z.string().optional().nullable(),
});

/**
 * Allocates commission and GST reversal in exact integer paise matching the parent invoice's
 * GST place-of-supply treatment and computes credit vs refund split against remaining balance.
 */
export function computeCreditNoteAllocation(params: {
  entryCommissionAmount: number;
  entryGstAmount: number;
  taxTreatmentMode: string;
  invoiceTotalPayable: number;
  invoiceAmountPaid: number;
  priorAppliedCredits: number;
}): {
  commissionReversalStr: string;
  cgstReversalStr: string;
  sgstReversalStr: string;
  igstReversalStr: string;
  gstReversalTotalStr: string;
  totalCreditStr: string;
  appliedToInvoiceBalanceStr: string;
  refundPayableToInstituteStr: string;
  status: "APPLIED_TO_INVOICE" | "REFUND_PENDING";
} {
  const commissionPaise = Math.max(0, toPaise(params.entryCommissionAmount));
  const gstTotalPaise = Math.max(0, toPaise(params.entryGstAmount));
  const totalCreditPaise = commissionPaise + gstTotalPaise;

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (params.taxTreatmentMode === "INTRA_STATE_CGST_SGST") {
    cgstPaise = Math.floor(gstTotalPaise / 2);
    sgstPaise = gstTotalPaise - cgstPaise;
  } else if (params.taxTreatmentMode === "INTER_STATE_IGST") {
    igstPaise = gstTotalPaise;
  }

  const invoiceTotalPaise = Math.max(0, toPaise(params.invoiceTotalPayable));
  const paidPaise = Math.max(0, toPaise(params.invoiceAmountPaid));
  const priorCreditedPaise = Math.max(0, toPaise(params.priorAppliedCredits));
  const remainingCollectiblePaise = Math.max(
    0,
    invoiceTotalPaise - priorCreditedPaise - paidPaise
  );

  const appliedPaise = Math.min(totalCreditPaise, remainingCollectiblePaise);
  const refundPaise = Math.max(0, totalCreditPaise - appliedPaise);

  return {
    commissionReversalStr: formatPaiseStr(commissionPaise),
    cgstReversalStr: formatPaiseStr(cgstPaise),
    sgstReversalStr: formatPaiseStr(sgstPaise),
    igstReversalStr: formatPaiseStr(igstPaise),
    gstReversalTotalStr: formatPaiseStr(gstTotalPaise),
    totalCreditStr: formatPaiseStr(totalCreditPaise),
    appliedToInvoiceBalanceStr: formatPaiseStr(appliedPaise),
    refundPayableToInstituteStr: formatPaiseStr(refundPaise),
    status: refundPaise > 0 ? "REFUND_PENDING" : "APPLIED_TO_INVOICE",
  };
}

export function toPaise(amount: number): number {
  return Math.round(Number(amount) * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

export function formatPaiseStr(paise: number): string {
  return (paise / 100).toFixed(2);
}

export interface CommissionBreakdownResult {
  commissionableTuition: number;
  commissionableTuitionStr: string;
  excludedNonTuitionAmount: number;
  excludedNonTuitionAmountStr: string;
  commissionRatePct: number;
  commissionRatePctStr: string;
  commissionAmount: number;
  commissionAmountStr: string;
  gstRatePct: number;
  gstRatePctStr: string;
  gstAmount: number;
  gstAmountStr: string;
  cgstAmountStr: string;
  sgstAmountStr: string;
  igstAmountStr: string;
  totalPayableAmount: number;
  totalPayableAmountStr: string;
}

/**
 * Computes AcademyFind B2B commission strictly on settled tuition (excluding registration,
 * hostel, study material, and optional perks) in exact integer paise, keeping GST segregated
 * from AcademyFind's net commission revenue.
 */
export function computeCommissionBreakdown(params: {
  commissionableTuition: number;
  excludedNonTuitionAmount?: number;
  commissionRatePct: number;
  gstRatePct?: number;
  taxTreatmentMode?: TaxTreatmentModeType;
}): CommissionBreakdownResult {
  const tuitionPaise = Math.max(0, toPaise(params.commissionableTuition));
  const excludedPaise = Math.max(0, toPaise(params.excludedNonTuitionAmount ?? 0));
  const rateBasisPoints = Math.round(Number(params.commissionRatePct) * 100); // e.g., 3.00% -> 300 bps
  const gstBasisPoints = Math.round(Number(params.gstRatePct ?? 18) * 100); // e.g., 18.00% -> 1800 bps

  const commissionPaise = Math.round((tuitionPaise * rateBasisPoints) / 10000);
  const gstPaise = Math.round((commissionPaise * gstBasisPoints) / 10000);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (params.taxTreatmentMode === "INTRA_STATE_CGST_SGST") {
    cgstPaise = Math.floor(gstPaise / 2);
    sgstPaise = gstPaise - cgstPaise;
  } else if (params.taxTreatmentMode === "INTER_STATE_IGST") {
    igstPaise = gstPaise;
  }

  const totalPaise = commissionPaise + gstPaise;

  return {
    commissionableTuition: fromPaise(tuitionPaise),
    commissionableTuitionStr: formatPaiseStr(tuitionPaise),
    excludedNonTuitionAmount: fromPaise(excludedPaise),
    excludedNonTuitionAmountStr: formatPaiseStr(excludedPaise),
    commissionRatePct: rateBasisPoints / 100,
    commissionRatePctStr: (rateBasisPoints / 100).toFixed(2),
    commissionAmount: fromPaise(commissionPaise),
    commissionAmountStr: formatPaiseStr(commissionPaise),
    gstRatePct: gstBasisPoints / 100,
    gstRatePctStr: (gstBasisPoints / 100).toFixed(2),
    gstAmount: fromPaise(gstPaise),
    gstAmountStr: formatPaiseStr(gstPaise),
    cgstAmountStr: formatPaiseStr(cgstPaise),
    sgstAmountStr: formatPaiseStr(sgstPaise),
    igstAmountStr: formatPaiseStr(igstPaise),
    totalPayableAmount: fromPaise(totalPaise),
    totalPayableAmountStr: formatPaiseStr(totalPaise),
  };
}

export interface QuorumSettlementPlan {
  isAdmissionQuorumMet: boolean;
  requiresDisclosureAtCounter: boolean;
  redemptionSettlementState: "SETTLED_FULL_DISCOUNT" | "PROVISIONAL_QUORUM_OPEN";
  postExpiryShortfallState:
    | "SETTLED_SHORTFALL_ABSORBED"
    | "PENDING_STUDENT_FALLBACK_CONSENT";
  lockedTuitionStr: string;
  disclosedFallbackFeeStr: string | null;
  qualifyingLowerSlabPct: number | null;
}

/**
 * Evaluates minAdmissionQuorum and all 3 fallback policies cleanly without ever applying
 * silent fee increases when an admitted cohort falls short of admission quorum.
 */
export function computeQuorumSettlementPlan(params: {
  fallbackPolicy: SlabFallbackPolicyType;
  minAdmissionQuorum: number;
  confirmedAdmissionsCount: number;
  baseFee: number;
  lockedOfferTuition: number;
  qualifyingLowerSlabPct?: number | null;
}): QuorumSettlementPlan {
  const isMet = params.confirmedAdmissionsCount >= params.minAdmissionQuorum;
  const lockedPaise = toPaise(params.lockedOfferTuition);
  const basePaise = toPaise(params.baseFee);

  if (params.fallbackPolicy === SlabFallbackPolicyEnum.enum.ABSORB_SHORTFALL || isMet) {
    return {
      isAdmissionQuorumMet: isMet,
      requiresDisclosureAtCounter: false,
      redemptionSettlementState: "SETTLED_FULL_DISCOUNT",
      postExpiryShortfallState: "SETTLED_SHORTFALL_ABSORBED",
      lockedTuitionStr: formatPaiseStr(lockedPaise),
      disclosedFallbackFeeStr: null,
      qualifyingLowerSlabPct: null,
    };
  }

  let disclosedPaise = basePaise;
  let usedPct: number | null = 0;

  if (
    params.fallbackPolicy === SlabFallbackPolicyEnum.enum.REVERT_TO_LOWER_SLAB &&
    params.qualifyingLowerSlabPct !== undefined &&
    params.qualifyingLowerSlabPct !== null &&
    params.qualifyingLowerSlabPct > 0
  ) {
    const bps = Math.round(params.qualifyingLowerSlabPct * 100);
    const disc = Math.round((basePaise * bps) / 10000);
    disclosedPaise = Math.max(0, basePaise - disc);
    usedPct = params.qualifyingLowerSlabPct;
  } else if (params.fallbackPolicy === SlabFallbackPolicyEnum.enum.CANCEL_DISCOUNT) {
    disclosedPaise = basePaise;
    usedPct = 0;
  }

  // Fallback price may never drop below locked offer fee if a better tier applied
  if (disclosedPaise < lockedPaise) {
    disclosedPaise = lockedPaise;
  }

  return {
    isAdmissionQuorumMet: false,
    requiresDisclosureAtCounter: true,
    redemptionSettlementState: "PROVISIONAL_QUORUM_OPEN",
    postExpiryShortfallState: "PENDING_STUDENT_FALLBACK_CONSENT",
    lockedTuitionStr: formatPaiseStr(lockedPaise),
    disclosedFallbackFeeStr: formatPaiseStr(disclosedPaise),
    qualifyingLowerSlabPct: usedPct,
  };
}

/**
 * Extracts voucher code from either a JSON QR payload `{ v: 1, code: "AFBB-..." }`
 * or a manually entered voucher string.
 */
export function parseQrOrVoucherCodeInput(raw: string): {
  mode: "QR_SCAN" | "MANUAL_CODE";
  voucherCode: string;
  qrPayloadRaw: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { code?: string };
      if (parsed.code && typeof parsed.code === "string") {
        return {
          mode: "QR_SCAN",
          voucherCode: parsed.code.trim().toUpperCase(),
          qrPayloadRaw: trimmed,
        };
      }
    } catch {
      // Fall through to validation rejection if malformed JSON
    }
  }
  return {
    mode: "MANUAL_CODE",
    voucherCode: trimmed.toUpperCase(),
    qrPayloadRaw: null,
  };
}
