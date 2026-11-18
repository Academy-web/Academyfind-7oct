"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { verifyVoucherQrPresentation } from "./voucherCrypto";
import {
  PreviewVoucherRedemptionSchema,
  RedeemVoucherSchema,
  RespondFallbackAdjustmentSchema,
  CancelBatchBuyAdmissionSchema,
  computeQuorumSettlementPlan,
  parseQrOrVoucherCodeInput,
  type RedeemVoucherInput,
} from "./commissionMath";
import {
  verifyCounterRedemptionAccess,
  resolveQualifyingLowerSlabPctTx,
} from "./redemptionAuth";
import type { SlabFallbackPolicyType } from "./slabValidation";
import { notifyUser } from "@/lib/notifications/notify";
import {
  redeemBatchBuyVoucherCore,
  settleExpiredOfferAdmissionQuorumCore,
  respondToFallbackAdjustmentCore,
  cancelOrRefundBatchBuyAdmissionCore,
} from "./core/redemptionCore";

/**
 * Step 1: Counter read-only QR/voucher preview before confirming student check-in.
 */
export async function previewVoucherForRedemptionAction(rawInput: {
  instituteId: string;
  qrPayloadOrCode: string;
}) {
  const parsed = PreviewVoucherRedemptionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid voucher input.",
    };
  }

  const authCheck = await verifyCounterRedemptionAccess(parsed.data.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return { success: false, error: authCheck.error || "Unauthorized counter access." };
  }

  const parsedInput = parseQrOrVoucherCodeInput(parsed.data.qrPayloadOrCode);

  const voucher = await prisma.admissionVoucher.findUnique({
    where: { voucherCode: parsedInput.voucherCode },
    include: {
      offer: {
        select: {
          id: true,
          status: true,
          version: true,
          fallbackPolicy: true,
          minAcceptanceQuorum: true,
          minAdmissionQuorum: true,
          publishedAt: true,
          offerExpiresAt: true,
          voucherExpiresAt: true,
          commissionRatePctSnapshot: true,
        },
      },
      cohort: { select: { id: true, cohortCode: true, title: true } },
      admissionRecord: { select: { id: true, status: true, admissionDate: true } },
    },
  });

  if (!voucher) {
    return {
      success: false,
      error: `No BatchBuy voucher found for code ${parsedInput.voucherCode}.`,
    };
  }

  if (voucher.instituteId !== parsed.data.instituteId) {
    return {
      success: false,
      error: "Voucher belongs to a different coaching institute and cannot be redeemed here.",
    };
  }

  if (parsedInput.qrPayloadRaw) {
    const qrCheck = verifyVoucherQrPresentation({
      qrPayloadRaw: parsedInput.qrPayloadRaw,
      storedVoucher: {
        voucherCode: voucher.voucherCode,
        securityNonce: voucher.securityNonce,
        offerId: voucher.offerId,
        offerVersion: voucher.offerVersion,
        cohortId: voucher.cohortId,
        cohortMemberId: voucher.cohortMemberId,
        userId: voucher.userId,
        instituteId: voucher.instituteId,
        batchId: voucher.batchId,
        expiresAtIso: voucher.expiresAt.toISOString(),
        tokenHash: voucher.tokenHash,
        status: voucher.status,
        expiresAt: voucher.expiresAt,
      },
    });
    if (!qrCheck.valid) {
      return { success: false, error: qrCheck.reason };
    }
  } else if (voucher.status !== "ACTIVE" || voucher.expiresAt <= new Date()) {
    return {
      success: false,
      error:
        voucher.status === "REDEEMED"
          ? `Voucher ${voucher.voucherCode} was already redeemed.`
          : voucher.expiresAt <= new Date()
          ? `Voucher ${voucher.voucherCode} expired on ${voucher.expiresAt.toLocaleDateString("en-IN")}.`
          : `Voucher ${voucher.voucherCode} is ${voucher.status} and not eligible for redemption.`,
    };
  }

  const confirmedCount = await prisma.admissionVoucher.count({
    where: {
      offerId: voucher.offerId,
      status: "REDEEMED",
      admissionRecord: {
        status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] },
      },
    },
  });

  const projectedCount = confirmedCount + 1;
  const lowerPct =
    voucher.fallbackPolicy === "REVERT_TO_LOWER_SLAB"
      ? await resolveQualifyingLowerSlabPctTx(prisma, {
          instituteId: voucher.instituteId,
          batchId: voucher.batchId,
          confirmedCount: projectedCount,
          offerPublishedAt: voucher.offer.publishedAt,
        })
      : null;

  const settlementPlan = computeQuorumSettlementPlan({
    fallbackPolicy: voucher.fallbackPolicy as SlabFallbackPolicyType,
    minAdmissionQuorum: voucher.minAdmissionQuorumSnapshot,
    confirmedAdmissionsCount: projectedCount,
    baseFee: Number(voucher.baseFee),
    lockedOfferTuition: Number(voucher.netPayableTuition),
    qualifyingLowerSlabPct: lowerPct,
  });

  return {
    success: true,
    preview: {
      voucherId: voucher.id,
      voucherCode: voucher.voucherCode,
      redemptionMethod: parsedInput.mode,
      studentName: voucher.studentNameSnapshot,
      instituteName: voucher.instituteNameSnapshot,
      batchName: voucher.batchNameSnapshot,
      cohortCode: voucher.cohort.cohortCode,
      cohortTitle: voucher.cohort.title,
      offerVersion: voucher.offerVersion,
      baseFee: Number(voucher.baseFee),
      registrationFeeOriginal: Number(voucher.registrationFeeOriginal),
      waiveRegistration: voucher.waiveRegistration,
      discountPercentage: Number(voucher.discountPercentage),
      discountAmount: Number(voucher.discountAmount),
      netPayableTuition: Number(voucher.netPayableTuition),
      includedPerks: voucher.includedPerks,
      fallbackPolicy: voucher.fallbackPolicy,
      minAdmissionQuorum: voucher.minAdmissionQuorumSnapshot,
      currentConfirmedAdmissions: confirmedCount,
      projectedAdmissionsAfterRedeem: projectedCount,
      requiresDisclosureAtCounter: settlementPlan.requiresDisclosureAtCounter,
      disclosedFallbackFee: settlementPlan.disclosedFallbackFeeStr
        ? Number(settlementPlan.disclosedFallbackFeeStr)
        : null,
      expiresAt: voucher.expiresAt.toISOString(),
    },
  };
}

/**
 * Step 2: Atomic single-use counter voucher redemption creating an official AdmissionRecord.
 */
export async function redeemBatchBuyVoucherAction(rawInput: RedeemVoucherInput) {
  const parsed = RedeemVoucherSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid voucher redemption input.",
    };
  }

  const authCheck = await verifyCounterRedemptionAccess(parsed.data.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return { success: false, error: authCheck.error || "Unauthorized counter access." };
  }

  const result = await redeemBatchBuyVoucherCore(parsed.data, {
    userId: authCheck.userId,
    userName: authCheck.userName || "Institute Counter Staff",
    actorRole: authCheck.actorRole || "INSTITUTE_MANAGER",
    isIsmRole: Boolean(authCheck.isIsmRole),
  });

  if (!result.success) {
    return result;
  }

  await notifyUser(
    result.studentUserId,
    "NOTICE",
    `Admission Confirmed via Voucher ${result.voucherCode}`,
    result.settlementState === "SETTLED_FULL_DISCOUNT"
      ? `Your center admission is confirmed at your locked BatchBuy offer tuition.`
      : `Your center admission is confirmed provisionally at your accepted offer tuition while cohort admissions reach minimum quorum (${result.confirmedAdmissionsCount}/${result.minAdmissionQuorum}).`,
    result.cohortCode
  );

  revalidatePath(`/batchbuy/${result.cohortCode}`);
  revalidatePath(`/manager/${result.instituteId}/admissions`);
  revalidatePath(`/manager/${result.instituteId}/batchbuy/redemptions`);

  return result;
}

/**
 * Step 3: Settles provisional admissions cleanly once offer.voucherExpiresAt elapses.
 */
export async function settleExpiredOfferAdmissionQuorumAction(offerId: string) {
  if (!offerId) return { success: false, error: "Offer ID is required." };

  const offerMeta = await prisma.cohortOffer.findUnique({
    where: { id: offerId },
    select: { id: true, instituteId: true },
  });
  if (!offerMeta) return { success: false, error: "Offer not found." };

  const authCheck = await verifyCounterRedemptionAccess(offerMeta.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return { success: false, error: authCheck.error || "Unauthorized." };
  }

  const settlement = await settleExpiredOfferAdmissionQuorumCore(offerId, {
    userId: authCheck.userId,
    actorRole: authCheck.actorRole || "INSTITUTE_MANAGER",
  });

  if (!settlement.success) return settlement;

  await Promise.allSettled(
    settlement.notifications.map((n) =>
      notifyUser(n.userId, "NOTICE", n.title, n.body, settlement.cohortCode)
    )
  );

  revalidatePath(`/batchbuy/${settlement.cohortCode}`);
  revalidatePath(`/manager/${settlement.instituteId}/batchbuy/redemptions`);

  return settlement;
}

/**
 * Step 4: Student's explicit decision on a quorum-shortfall adjustment.
 */
export async function respondToFallbackAdjustmentAction(rawInput: {
  voucherId: string;
  acceptFallbackPrice: boolean;
  note?: string | null;
}) {
  const parsed = RespondFallbackAdjustmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid response." };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { success: false, error: "Please log in to respond." };
  }

  const result = await respondToFallbackAdjustmentCore(parsed.data, session.user.id);
  if (!result.success) return result;

  revalidatePath(`/batchbuy/${result.cohortCode}`);
  revalidatePath(`/manager/${result.instituteId}/admissions`);
  revalidatePath(`/manager/${result.instituteId}/batchbuy/redemptions`);

  return result;
}

/**
 * Step 5: Cancels/refunds a BatchBuy AdmissionRecord cleanly within or after the 15-day hold.
 */
export async function cancelOrRefundBatchBuyAdmissionAction(rawInput: {
  admissionId: string;
  reason: string;
  directRefundRequiredAmount?: number | null;
  directRefundCompleted?: boolean;
}) {
  const parsed = CancelBatchBuyAdmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid cancellation input." };
  }

  const lookup = await prisma.admissionRecord.findUnique({
    where: { id: parsed.data.admissionId },
    select: { id: true, instituteId: true, batchBuyVoucherId: true },
  });
  if (!lookup || !lookup.batchBuyVoucherId) {
    return { success: false, error: "BatchBuy admission record not found." };
  }

  const authCheck = await verifyCounterRedemptionAccess(lookup.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return { success: false, error: authCheck.error || "Unauthorized." };
  }

  const outcome = await cancelOrRefundBatchBuyAdmissionCore(parsed.data, {
    userId: authCheck.userId,
    actorRole: authCheck.actorRole || "INSTITUTE_MANAGER",
  });

  if (!outcome.success) return outcome;

  revalidatePath(`/manager/${outcome.instituteId}/admissions`);
  revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  if (outcome.cohortCode) revalidatePath(`/batchbuy/${outcome.cohortCode}`);

  return outcome;
}
