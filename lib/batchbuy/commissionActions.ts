"use server";

import { revalidatePath } from "next/cache";
import type { TaxTreatmentModeType } from "./commissionMath";
import { verifyPlatformAdminAccess } from "./redemptionAuth";
import {
  reviewFlaggedAttributionCore,
  matureEligibleCommissionsCore,
  generateCommissionInvoiceCore,
  issueCommissionInvoiceCore,
  recordCommissionPaymentCore,
  settleCreditNoteRefundCore,
} from "./core/commissionCore";

/**
 * Platform ADMIN adjudicates a FLAGGED_SUSPECTED_BYPASS CRM admission.
 */
export async function reviewFlaggedAttributionAction(rawInput: {
  attributionId: string;
  decision: "CONFIRMED_BYPASS" | "DISMISSED_FALSE_POSITIVE";
  reviewNote: string;
}) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await reviewFlaggedAttributionCore(rawInput, adminCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Transitions finalized, verified HOLD_PERIOD commissions to ELIGIBLE once the cooling-off period elapses.
 */
export async function matureEligibleCommissionsAction(instituteId?: string) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await matureEligibleCommissionsCore(instituteId, adminCheck.userId);
  if (outcome.success && instituteId) {
    revalidatePath(`/manager/${instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Platform ADMIN generates a B2B commission invoice for matured ELIGIBLE admissions.
 */
export async function generateCommissionInvoiceAction(rawInput: {
  instituteId: string;
  periodStart: string;
  periodEnd: string;
  taxTreatmentMode?: TaxTreatmentModeType;
  sacCodeOverride?: string | null;
  instituteGstin?: string | null;
  academyFindGstin?: string | null;
  notes?: string | null;
  issueImmediately?: boolean;
}) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await generateCommissionInvoiceCore(rawInput, adminCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Transitions a DRAFT commission invoice to ISSUED once CA validation and GST mode are confirmed.
 */
export async function issueCommissionInvoiceAction(
  invoiceId: string,
  overrideTaxMode?: TaxTreatmentModeType
) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await issueCommissionInvoiceCore(
    invoiceId,
    adminCheck.userId,
    overrideTaxMode
  );
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Records an institute-to-AcademyFind B2B commission settlement against an issued invoice.
 */
export async function recordCommissionPaymentAction(rawInput: {
  invoiceId: string;
  amount: number;
  paymentMode: "NEFT" | "RTGS" | "IMPS" | "UPI_B2B" | "RAZORPAY_B2B_LINK" | "CHEQUE";
  utrOrReference: string;
  paidAt?: string | null;
  note?: string | null;
}) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await recordCommissionPaymentCore(rawInput, adminCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Records settlement UTR for a REFUND_PENDING credit note (post-payment clawback refund to institute).
 */
export async function settleCreditNoteRefundAction(rawInput: {
  creditNoteId: string;
  utrOrReference: string;
  settledAt?: string | null;
}) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await settleCreditNoteRefundCore(rawInput, adminCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}
