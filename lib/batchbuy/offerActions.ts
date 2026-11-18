"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { verifyInstituteManagerAccess } from "./slabActions";
import { writeBatchBuyAuditLogTx } from "./redemptionAuth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getActiveAgreementForInstituteTx } from "./agreementActions";
import {
  normalizeIndianPhone,
  maskPhone,
  resolveMemberIntentState,
} from "./cohortValidation";
import {
  SaveCohortOfferSchema,
  SaveCohortOfferInput,
  RespondToOfferSchema,
  RespondToOfferInput,
  VerifyGuardianConsentSchema,
  computeOfferFeeBreakdown,
  validateOfferQuorumsAndDates,
  evaluateVoucherEligibility,
  type CohortOfferStatusType,
  type VoucherStatusType,
} from "./offerValidation";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
  createGuardianConsentChallenge,
  verifyGuardianOtpHash,
} from "./voucherCrypto";
import type { SlabFallbackPolicyType } from "./slabValidation";
import { notifyUser } from "@/lib/notifications/notify";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";

function formatInrSimple(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

async function expireElapsedOfferAndVouchersTx(
  tx: Prisma.TransactionClient,
  offerId: string
): Promise<void> {
  await tx.cohortOffer.updateMany({
    where: { id: offerId, status: "PUBLISHED" },
    data: { status: "EXPIRED" },
  });

  await tx.admissionVoucher.updateMany({
    where: { offerId, status: "PENDING_QUORUM" },
    data: {
      status: "EXPIRED",
      revokeReason:
        "Offer acceptance deadline elapsed before reaching minimum acceptance quorum.",
    },
  });
}

async function expireElapsedCohortOffersTx(
  tx: Prisma.TransactionClient,
  cohortId: string,
  now: Date
): Promise<void> {
  const staleOffers = await tx.cohortOffer.findMany({
    where: {
      cohortId,
      OR: [
        { status: "PUBLISHED", offerExpiresAt: { lte: now } },
        {
          status: "EXPIRED",
          vouchers: { some: { status: "PENDING_QUORUM" } },
        },
      ],
    },
    select: { id: true },
  });

  for (const stale of staleOffers) {
    await expireElapsedOfferAndVouchersTx(tx, stale.id);
  }
}

export interface SerializedIssuedVoucher {
  id: string;
  voucherCode: string;
  offerId: string;
  offerVersion: number;
  cohortId: string;
  cohortCode: string;
  cohortMemberId: string;
  userId: string;
  instituteId: string;
  batchId: string;
  status: VoucherStatusType;
  effectiveStatus: VoucherStatusType;
  isRedeemable: boolean;
  eligibilityReason: string;
  baseFee: number;
  registrationFeeOriginal: number;
  waiveRegistration: boolean;
  discountPercentage: number;
  discountAmount: number;
  netPayableTuition: number;
  includedPerks: string[];
  fallbackPolicy: SlabFallbackPolicyType;
  minAcceptanceQuorum: number;
  minAdmissionQuorum: number;
  acceptedCount: number;
  studentNameSnapshot: string;
  instituteNameSnapshot: string;
  batchNameSnapshot: string;
  issuedAt: string;
  activatedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  redeemedAt?: string | null;
  settlementState?: string | null;
  disclosedFallbackFee?: number | null;
  settledTuition?: number | null;
  fallbackConsentRequestedAt?: string | null;
  fallbackConsentRespondedAt?: string | null;
  fallbackConsentAccepted?: boolean | null;
  admissionStatus?: string | null;
  directRefundRequiredAmount?: number | null;
  directRefundStatus?: string | null;
  qrPayload: string;
  verificationChecksum: string;
}

function serializeVoucherRecord(params: {
  voucher: {
    id: string;
    voucherCode: string;
    securityNonce: string;
    offerId: string;
    offerVersion: number;
    cohortId: string;
    cohortMemberId: string;
    userId: string;
    instituteId: string;
    batchId: string;
    status: string;
    baseFee: Prisma.Decimal | number | string;
    registrationFeeOriginal: Prisma.Decimal | number | string;
    waiveRegistration: boolean;
    discountPercentage: Prisma.Decimal | number | string;
    discountAmount: Prisma.Decimal | number | string;
    netPayableTuition: Prisma.Decimal | number | string;
    includedPerks: string[];
    fallbackPolicy: string;
    minAcceptanceQuorumSnapshot: number;
    minAdmissionQuorumSnapshot: number;
    studentNameSnapshot: string;
    instituteNameSnapshot: string;
    batchNameSnapshot: string;
    issuedAt: Date;
    activatedAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
    revokeReason: string | null;
    redeemedAt?: Date | null;
    settlementState?: string | null;
    disclosedFallbackFee?: Prisma.Decimal | number | string | null;
    settledTuition?: Prisma.Decimal | number | string | null;
    fallbackConsentRequestedAt?: Date | null;
    fallbackConsentRespondedAt?: Date | null;
    fallbackConsentAccepted?: boolean | null;
  };
  cohortCode: string;
  offerStatus: CohortOfferStatusType;
  offerExpiresAt?: Date | null;
  acceptedCount: number;
  now?: Date;
}): SerializedIssuedVoucher {
  const { voucher } = params;
  const eligibility = evaluateVoucherEligibility({
    status: voucher.status as VoucherStatusType,
    offerStatus: params.offerStatus,
    offerExpiresAt: params.offerExpiresAt,
    expiresAt: voucher.expiresAt,
    minAcceptanceQuorum: voucher.minAcceptanceQuorumSnapshot,
    acceptedCount: params.acceptedCount,
    now: params.now,
  });

  const { qrPayload, verificationChecksum } = computeVoucherQrPayload({
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
  });

  return {
    id: voucher.id,
    voucherCode: voucher.voucherCode,
    offerId: voucher.offerId,
    offerVersion: voucher.offerVersion,
    cohortId: voucher.cohortId,
    cohortCode: params.cohortCode,
    cohortMemberId: voucher.cohortMemberId,
    userId: voucher.userId,
    instituteId: voucher.instituteId,
    batchId: voucher.batchId,
    status: voucher.status as VoucherStatusType,
    effectiveStatus: eligibility.effectiveStatus,
    isRedeemable: eligibility.isRedeemable,
    eligibilityReason: eligibility.reason,
    baseFee: Number(voucher.baseFee),
    registrationFeeOriginal: Number(voucher.registrationFeeOriginal),
    waiveRegistration: voucher.waiveRegistration,
    discountPercentage: Number(voucher.discountPercentage),
    discountAmount: Number(voucher.discountAmount),
    netPayableTuition: Number(voucher.netPayableTuition),
    includedPerks: voucher.includedPerks,
    fallbackPolicy: voucher.fallbackPolicy as SlabFallbackPolicyType,
    minAcceptanceQuorum: voucher.minAcceptanceQuorumSnapshot,
    minAdmissionQuorum: voucher.minAdmissionQuorumSnapshot,
    acceptedCount: params.acceptedCount,
    studentNameSnapshot: voucher.studentNameSnapshot,
    instituteNameSnapshot: voucher.instituteNameSnapshot,
    batchNameSnapshot: voucher.batchNameSnapshot,
    issuedAt: voucher.issuedAt.toISOString(),
    activatedAt: voucher.activatedAt ? voucher.activatedAt.toISOString() : null,
    expiresAt: voucher.expiresAt.toISOString(),
    revokedAt: voucher.revokedAt ? voucher.revokedAt.toISOString() : null,
    revokeReason: voucher.revokeReason,
    redeemedAt: voucher.redeemedAt ? voucher.redeemedAt.toISOString() : null,
    settlementState: voucher.settlementState ?? null,
    disclosedFallbackFee:
      voucher.disclosedFallbackFee != null ? Number(voucher.disclosedFallbackFee) : null,
    settledTuition:
      voucher.settledTuition != null ? Number(voucher.settledTuition) : null,
    fallbackConsentRequestedAt: voucher.fallbackConsentRequestedAt
      ? voucher.fallbackConsentRequestedAt.toISOString()
      : null,
    fallbackConsentRespondedAt: voucher.fallbackConsentRespondedAt
      ? voucher.fallbackConsentRespondedAt.toISOString()
      : null,
    fallbackConsentAccepted: voucher.fallbackConsentAccepted ?? null,
    qrPayload,
    verificationChecksum,
  };
}

/**
 * Helper to post a SYSTEM notice message inside a cohort's Conversation and bump timestamps.
 */
async function postCohortSystemMessage(
  conversationId: string | null,
  senderId: string,
  content: string
) {
  if (!conversationId) return;
  try {
    const now = new Date();
    await prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: "SYSTEM",
        content,
        searchText: content,
        senderNameSnapshot: "AcademyFind BatchBuy",
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: now,
        lastActivityAt: now,
      },
    });
  } catch (err) {
    console.error("Failed to post BatchBuy offer system chat message:", err);
  }
}

/**
 * Creates a new versioned cohort offer (as DRAFT or immediately PUBLISHED),
 * or updates an existing DRAFT offer.
 * Strictly enforces manager authorization and immutability of already-published versions.
 */
export async function saveCohortOfferAction(rawInput: SaveCohortOfferInput) {
  const parsed = SaveCohortOfferSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid cohort offer input.",
    };
  }

  const input = parsed.data;
  const cohortLookup = await prisma.groupAdmissionCohort.findUnique({
    where: { id: input.cohortId },
    select: {
      id: true,
      instituteId: true,
      batchId: true,
      cohortCode: true,
      maxCapacity: true,
      conversationId: true,
    },
  });

  if (!cohortLookup) {
    return { success: false, error: "Cohort not found." };
  }

  const authCheck = await verifyInstituteManagerAccess(cohortLookup.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return {
      success: false,
      error: authCheck.error || "Only authorized Institute Managers or Admins can manage offers.",
    };
  }

  const managerUserId = authCheck.userId;

  let dates: { offerExpiresAt: Date; voucherExpiresAt: Date };
  try {
    dates = validateOfferQuorumsAndDates({
      minAcceptanceQuorum: input.minAcceptanceQuorum,
      minAdmissionQuorum: input.minAdmissionQuorum,
      cohortMaxCapacity: cohortLookup.maxCapacity,
      offerExpiresAtRaw: input.offerExpiresAt,
      voucherExpiresAtRaw: input.voucherExpiresAt,
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Invalid offer quorum or dates.",
    };
  }

  const feeBreakdown = computeOfferFeeBreakdown({
    baseFee: input.baseFee,
    registrationFeeOriginal: input.registrationFeeOriginal,
    waiveRegistration: input.waiveRegistration,
    discountPercentage: input.discountPercentage,
  });

  const cleanedPerks = Array.from(
    new Set(input.includedPerks.map((p) => p.trim()).filter(Boolean))
  );

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // Deterministic row lock on cohort prevents concurrent version collisions or double publish
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${input.cohortId} FOR UPDATE`;

        const cohort = await tx.groupAdmissionCohort.findUnique({
          where: { id: input.cohortId },
          include: {
            institute: { select: { id: true, name: true } },
            batch: { select: { id: true, name: true } },
            members: {
              where: { stage: { not: "DROPPED" } },
              select: {
                id: true,
                userId: true,
                stage: true,
                phoneVerified: true,
                profileConfirmed: true,
                explicitIntentAt: true,
              },
            },
          },
        });

        if (!cohort) {
          throw new Error("Cohort not found.");
        }

        if (["CANCELLED", "EXPIRED", "COMPLETED"].includes(cohort.status)) {
          throw new Error(
            `Cannot create or publish an offer because this cohort is ${cohort.status}.`
          );
        }

        // Verify optional sourceSlabId belongs to this institute & is non-archived
        if (input.sourceSlabId) {
          const slab = await tx.groupDiscountSlab.findUnique({
            where: { id: input.sourceSlabId },
            select: { id: true, instituteId: true, batchId: true, isArchived: true, isActive: true },
          });
          if (
            !slab ||
            slab.instituteId !== cohort.instituteId ||
            slab.isArchived ||
            !slab.isActive ||
            (slab.batchId !== null && slab.batchId !== cohort.batchId)
          ) {
            throw new Error("Referenced discount slab is not valid for this institute batch.");
          }
        }

        // Flush any elapsed PUBLISHED offers and their PENDING_QUORUM vouchers first
        await expireElapsedCohortOffersTx(tx, cohort.id, now);

        // Enforce active, signed InstituteBatchBuyAgreement when publishing an offer (no silent 3% fallback)
        let activeAgreement: Awaited<ReturnType<typeof getActiveAgreementForInstituteTx>> = null;
        if (input.publishImmediately) {
          activeAgreement = await getActiveAgreementForInstituteTx(tx, cohort.instituteId, now);
          if (!activeAgreement) {
            throw new Error(
              "Cannot publish BatchBuy offer: this institute does not have an active, signed BatchBuy Commercial Agreement (2%, 3%, or 4%)."
            );
          }

          const redeemedCount = await tx.admissionVoucher.count({
            where: {
              cohortId: cohort.id,
              status: "REDEEMED",
            },
          });
          if (redeemedCount > 0) {
            throw new Error(
              "Cannot supersede an active offer version because vouchers have already been redeemed."
            );
          }

          await tx.cohortOffer.updateMany({
            where: {
              cohortId: cohort.id,
              status: { in: ["PUBLISHED", "QUORUM_MET"] },
            },
            data: {
              status: "SUPERSEDED",
              supersededAt: now,
            },
          });

          await tx.admissionVoucher.updateMany({
            where: {
              cohortId: cohort.id,
              status: { in: ["PENDING_QUORUM", "ACTIVE"] },
            },
            data: {
              status: "REVOKED",
              revokedAt: now,
              revokeReason: "Superseded by a newer cohort offer version.",
            },
          });

          // Re-open eligible member stages cleanly for individual decision on new offer version
          for (const member of cohort.members) {
            if (["OFFER_ACCEPTED", "OFFER_DECLINED", "VOUCHER_ISSUED"].includes(member.stage)) {
              const intent = resolveMemberIntentState(member);
              await tx.groupCohortMember.update({
                where: { id: member.id },
                data: {
                  stage: intent.isFullyIntentVerified ? "INTENT_VERIFIED" : "INTERESTED",
                },
              });
            }
          }
        }

        let savedOffer;
        if (input.offerId) {
          // Lock the offer row before checking DRAFT mutability
          await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${input.offerId} FOR UPDATE`;
          const existing = await tx.cohortOffer.findUnique({
            where: { id: input.offerId },
          });

          if (!existing || existing.cohortId !== cohort.id) {
            throw new Error("Offer draft not found for this cohort.");
          }

          if (existing.status !== "DRAFT") {
            throw new Error(
              `Offer v${existing.version} is already ${existing.status} and is immutable. Create a new offer version to change terms.`
            );
          }

          savedOffer = await tx.cohortOffer.update({
            where: { id: existing.id },
            data: {
              sourceSlabId: input.sourceSlabId ?? null,
              status: input.publishImmediately ? "PUBLISHED" : "DRAFT",
              title: input.title,
              baseFee: new Prisma.Decimal(feeBreakdown.baseFeeStr),
              registrationFeeOriginal: new Prisma.Decimal(feeBreakdown.registrationFeeOriginalStr),
              waiveRegistration: input.waiveRegistration,
              discountPercentage: new Prisma.Decimal(feeBreakdown.discountPercentageStr),
              discountAmount: new Prisma.Decimal(feeBreakdown.discountAmountStr),
              netPayableTuition: new Prisma.Decimal(feeBreakdown.netPayableTuitionStr),
              includedPerks: cleanedPerks,
              fallbackPolicy: input.fallbackPolicy,
              paymentTerms: input.paymentTerms?.trim() || null,
              additionalNotes: input.additionalNotes?.trim() || null,
              minAcceptanceQuorum: input.minAcceptanceQuorum,
              minAdmissionQuorum: input.minAdmissionQuorum,
              offerExpiresAt: dates.offerExpiresAt,
              voucherExpiresAt: dates.voucherExpiresAt,
              publishedAt: input.publishImmediately ? now : null,
              publishedById: input.publishImmediately ? managerUserId : null,
              ...(activeAgreement
                ? {
                    commissionAgreementId: activeAgreement.id,
                    commissionRatePctSnapshot: activeAgreement.commissionRatePct,
                    commissionTierSnapshot: activeAgreement.rateTier,
                    attributionWindowDaysSnapshot: activeAgreement.attributionWindowDays,
                    holdingPeriodDaysSnapshot: activeAgreement.holdingPeriodDays,
                  }
                : {}),
            },
          });
        } else {
          const latest = await tx.cohortOffer.findFirst({
            where: { cohortId: cohort.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          const nextVersion = (latest?.version ?? 0) + 1;

          savedOffer = await tx.cohortOffer.create({
            data: {
              cohortId: cohort.id,
              instituteId: cohort.instituteId,
              batchId: cohort.batchId,
              version: nextVersion,
              sourceSlabId: input.sourceSlabId ?? null,
              status: input.publishImmediately ? "PUBLISHED" : "DRAFT",
              title: input.title,
              baseFee: new Prisma.Decimal(feeBreakdown.baseFeeStr),
              registrationFeeOriginal: new Prisma.Decimal(feeBreakdown.registrationFeeOriginalStr),
              waiveRegistration: input.waiveRegistration,
              discountPercentage: new Prisma.Decimal(feeBreakdown.discountPercentageStr),
              discountAmount: new Prisma.Decimal(feeBreakdown.discountAmountStr),
              netPayableTuition: new Prisma.Decimal(feeBreakdown.netPayableTuitionStr),
              includedPerks: cleanedPerks,
              fallbackPolicy: input.fallbackPolicy,
              paymentTerms: input.paymentTerms?.trim() || null,
              additionalNotes: input.additionalNotes?.trim() || null,
              minAcceptanceQuorum: input.minAcceptanceQuorum,
              minAdmissionQuorum: input.minAdmissionQuorum,
              offerExpiresAt: dates.offerExpiresAt,
              voucherExpiresAt: dates.voucherExpiresAt,
              publishedAt: input.publishImmediately ? now : null,
              createdById: managerUserId,
              publishedById: input.publishImmediately ? managerUserId : null,
              ...(activeAgreement
                ? {
                    commissionAgreementId: activeAgreement.id,
                    commissionRatePctSnapshot: activeAgreement.commissionRatePct,
                    commissionTierSnapshot: activeAgreement.rateTier,
                    attributionWindowDaysSnapshot: activeAgreement.attributionWindowDays,
                    holdingPeriodDaysSnapshot: activeAgreement.holdingPeriodDays,
                  }
                : {}),
            },
          });
        }

        if (input.publishImmediately) {
          await tx.groupAdmissionCohort.update({
            where: { id: cohort.id },
            data: { status: "OFFER_ACTIVE" },
          });
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: cohort.instituteId,
          actorUserId: managerUserId,
          actorRole: "INSTITUTE_MANAGER",
          action: input.publishImmediately ? "OFFER_PUBLISHED" : "OFFER_DRAFT_SAVED",
          entityType: "CohortOffer",
          entityId: savedOffer.id,
          afterState: {
            cohortId: cohort.id,
            version: savedOffer.version,
            status: savedOffer.status,
            fallbackPolicy: savedOffer.fallbackPolicy,
          },
        });

        return {
          savedOffer,
          cohortCode: cohort.cohortCode,
          instituteId: cohort.instituteId,
          instituteName: cohort.institute.name,
          batchName: cohort.batch.name,
          conversationId: cohort.conversationId,
          memberUserIds: cohort.members.map((m) => m.userId),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (input.publishImmediately) {
      const pct = Number(result.savedOffer.discountPercentage);
      const net = Number(result.savedOffer.netPayableTuition);
      const expiryLabel = result.savedOffer.offerExpiresAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      await postCohortSystemMessage(
        result.conversationId,
        managerUserId,
        `Official Group Offer v${result.savedOffer.version} published by ${result.instituteName}: ${pct}% OFF (${formatInrSimple(net)} net tuition). Min Acceptance Quorum: ${result.savedOffer.minAcceptanceQuorum} students | Min Center Admission Quorum: ${result.savedOffer.minAdmissionQuorum} students. Respond individually by ${expiryLabel}.`
      );

      await Promise.allSettled(
        result.memberUserIds.map((uid) =>
          notifyUser(
            uid,
            "NOTICE",
            `Official Offer v${result.savedOffer.version} for ${result.cohortCode}`,
            `${result.instituteName} published ${pct}% OFF (${formatInrSimple(net)}) for ${result.batchName}. Review terms & respond individually.`,
            result.cohortCode
          )
        )
      );
    }

    revalidatePath(`/batchbuy/${result.cohortCode}`);
    revalidatePath(`/batchbuy`);
    revalidatePath(`/manager/${result.instituteId}/batchbuy/offers`);

    return {
      success: true,
      offerId: result.savedOffer.id,
      version: result.savedOffer.version,
      status: result.savedOffer.status as CohortOfferStatusType,
    };
  } catch (err: unknown) {
    console.error("Failed to save BatchBuy cohort offer:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return {
        success: false,
        error: "Concurrent offer update detected. Please refresh and try again.",
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save cohort offer.",
    };
  }
}

/**
 * Transitions an immutable DRAFT offer to PUBLISHED, superseding any earlier active offer.
 */
export async function publishDraftCohortOfferAction(offerId: string) {
  if (!offerId) {
    return { success: false, error: "Offer ID is required." };
  }

  const lookup = await prisma.cohortOffer.findUnique({
    where: { id: offerId },
    select: { id: true, cohortId: true, instituteId: true },
  });

  if (!lookup) {
    return { success: false, error: "Offer not found." };
  }

  const authCheck = await verifyInstituteManagerAccess(lookup.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return {
      success: false,
      error: authCheck.error || "Only authorized Institute Managers or Admins can publish offers.",
    };
  }
  const managerUserId = authCheck.userId;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${lookup.cohortId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${offerId} FOR UPDATE`;

        const offer = await tx.cohortOffer.findUnique({
          where: { id: offerId },
          include: {
            institute: { select: { name: true } },
            batch: { select: { name: true } },
            cohort: {
              select: {
                id: true,
                cohortCode: true,
                status: true,
                conversationId: true,
                members: {
                  where: { stage: { not: "DROPPED" } },
                  select: {
                    id: true,
                    userId: true,
                    stage: true,
                    phoneVerified: true,
                    profileConfirmed: true,
                    explicitIntentAt: true,
                  },
                },
              },
            },
          },
        });

        if (!offer) {
          throw new Error("Offer not found.");
        }
        if (offer.status !== "DRAFT") {
          throw new Error(`Offer v${offer.version} is already ${offer.status} and cannot be re-published.`);
        }
        if (["CANCELLED", "EXPIRED", "COMPLETED"].includes(offer.cohort.status)) {
          throw new Error(`Cannot publish offer for ${offer.cohort.status} cohort.`);
        }
        if (offer.offerExpiresAt <= now || offer.voucherExpiresAt < offer.offerExpiresAt) {
          throw new Error("Offer acceptance deadline has passed or is invalid. Edit draft dates before publishing.");
        }

        await expireElapsedCohortOffersTx(tx, offer.cohortId, now);

        const activeAgreement = await getActiveAgreementForInstituteTx(tx, offer.instituteId, now);
        if (!activeAgreement) {
          throw new Error(
            "Cannot publish BatchBuy offer: this institute does not have an active, signed BatchBuy Commercial Agreement (2%, 3%, or 4%)."
          );
        }

        const redeemedCount = await tx.admissionVoucher.count({
          where: { cohortId: offer.cohortId, status: "REDEEMED" },
        });
        if (redeemedCount > 0) {
          throw new Error("Cannot publish a new offer version because an earlier voucher was already redeemed.");
        }

        await tx.cohortOffer.updateMany({
          where: {
            cohortId: offer.cohortId,
            id: { not: offer.id },
            status: { in: ["PUBLISHED", "QUORUM_MET"] },
          },
          data: {
            status: "SUPERSEDED",
            supersededAt: now,
          },
        });

        await tx.admissionVoucher.updateMany({
          where: {
            cohortId: offer.cohortId,
            offerId: { not: offer.id },
            status: { in: ["PENDING_QUORUM", "ACTIVE"] },
          },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokeReason: `Superseded by Offer v${offer.version}.`,
          },
        });

        for (const member of offer.cohort.members) {
          if (["OFFER_ACCEPTED", "OFFER_DECLINED", "VOUCHER_ISSUED"].includes(member.stage)) {
            const intent = resolveMemberIntentState(member);
            await tx.groupCohortMember.update({
              where: { id: member.id },
              data: {
                stage: intent.isFullyIntentVerified ? "INTENT_VERIFIED" : "INTERESTED",
              },
            });
          }
        }

        const publishedOffer = await tx.cohortOffer.update({
          where: { id: offer.id },
          data: {
            status: "PUBLISHED",
            publishedAt: now,
            publishedById: managerUserId,
            commissionAgreementId: activeAgreement.id,
            commissionRatePctSnapshot: activeAgreement.commissionRatePct,
            commissionTierSnapshot: activeAgreement.rateTier,
            attributionWindowDaysSnapshot: activeAgreement.attributionWindowDays,
            holdingPeriodDaysSnapshot: activeAgreement.holdingPeriodDays,
          },
        });

        await tx.groupAdmissionCohort.update({
          where: { id: offer.cohortId },
          data: { status: "OFFER_ACTIVE" },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: offer.instituteId,
          actorUserId: managerUserId,
          actorRole: "INSTITUTE_MANAGER",
          action: "OFFER_PUBLISHED",
          entityType: "CohortOffer",
          entityId: offer.id,
          beforeState: { status: "DRAFT" },
          afterState: { status: "PUBLISHED", version: offer.version },
        });

        return {
          publishedOffer,
          cohortCode: offer.cohort.cohortCode,
          instituteId: offer.instituteId,
          instituteName: offer.institute.name,
          batchName: offer.batch.name,
          conversationId: offer.cohort.conversationId,
          memberUserIds: offer.cohort.members.map((m) => m.userId),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const pct = Number(result.publishedOffer.discountPercentage);
    const net = Number(result.publishedOffer.netPayableTuition);

    await postCohortSystemMessage(
      result.conversationId,
      managerUserId,
      `Official Group Offer v${result.publishedOffer.version} published by ${result.instituteName}: ${pct}% OFF (${formatInrSimple(net)} net tuition). Min Acceptance Quorum: ${result.publishedOffer.minAcceptanceQuorum} | Min Admission Quorum: ${result.publishedOffer.minAdmissionQuorum}.`
    );

    await Promise.allSettled(
      result.memberUserIds.map((uid) =>
        notifyUser(
          uid,
          "NOTICE",
          `Offer v${result.publishedOffer.version} Live for ${result.cohortCode}`,
          `${result.instituteName} published ${pct}% OFF (${formatInrSimple(net)}) for ${result.batchName}.`,
          result.cohortCode
        )
      )
    );

    revalidatePath(`/batchbuy/${result.cohortCode}`);
    revalidatePath(`/manager/${result.instituteId}/batchbuy/offers`);

    return {
      success: true,
      offerId: result.publishedOffer.id,
      version: result.publishedOffer.version,
    };
  } catch (err: unknown) {
    console.error("Failed to publish draft cohort offer:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to publish cohort offer.",
    };
  }
}

/**
 * Allows an authorized institute manager to withdraw a DRAFT or active unredeemed offer.
 */
export async function withdrawCohortOfferAction(offerId: string) {
  if (!offerId) {
    return { success: false, error: "Offer ID is required." };
  }

  const lookup = await prisma.cohortOffer.findUnique({
    where: { id: offerId },
    select: { id: true, cohortId: true, instituteId: true },
  });

  if (!lookup) {
    return { success: false, error: "Offer not found." };
  }

  const authCheck = await verifyInstituteManagerAccess(lookup.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return {
      success: false,
      error: authCheck.error || "Only authorized Institute Managers or Admins can withdraw offers.",
    };
  }
  const managerUserId = authCheck.userId;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${lookup.cohortId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${offerId} FOR UPDATE`;

        const offer = await tx.cohortOffer.findUnique({
          where: { id: offerId },
          include: {
            cohort: {
              include: {
                members: {
                  where: { stage: { not: "DROPPED" } },
                  select: {
                    id: true,
                    userId: true,
                    stage: true,
                    phoneVerified: true,
                    profileConfirmed: true,
                    explicitIntentAt: true,
                  },
                },
              },
            },
          },
        });

        if (!offer) {
          throw new Error("Offer not found.");
        }

        if (!["DRAFT", "PUBLISHED", "QUORUM_MET"].includes(offer.status)) {
          throw new Error(`Offer v${offer.version} is already ${offer.status} and cannot be withdrawn.`);
        }

        const redeemedCount = await tx.admissionVoucher.count({
          where: { offerId: offer.id, status: "REDEEMED" },
        });
        if (redeemedCount > 0) {
          throw new Error("Cannot withdraw offer after vouchers have been redeemed.");
        }

        const wasPublished = offer.status !== "DRAFT";

        await tx.cohortOffer.update({
          where: { id: offer.id },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: now,
          },
        });

        if (wasPublished) {
          await tx.admissionVoucher.updateMany({
            where: {
              offerId: offer.id,
              status: { in: ["PENDING_QUORUM", "ACTIVE"] },
            },
            data: {
              status: "REVOKED",
              revokedAt: now,
              revokeReason: "Offer withdrawn by institute manager.",
            },
          });

          for (const member of offer.cohort.members) {
            if (["OFFER_ACCEPTED", "OFFER_DECLINED", "VOUCHER_ISSUED"].includes(member.stage)) {
              const intent = resolveMemberIntentState(member);
              await tx.groupCohortMember.update({
                where: { id: member.id },
                data: {
                  stage: intent.isFullyIntentVerified ? "INTENT_VERIFIED" : "INTERESTED",
                },
              });
            }
          }

          if (!["CANCELLED", "COMPLETED"].includes(offer.cohort.status)) {
            await tx.groupAdmissionCohort.update({
              where: { id: offer.cohortId },
              data: {
                status: offer.cohort.formingExpiresAt > now ? "FORMING" : "EXPIRED",
              },
            });
          }
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: offer.instituteId,
          actorUserId: managerUserId,
          actorRole: "INSTITUTE_MANAGER",
          action: "OFFER_WITHDRAWN",
          entityType: "CohortOffer",
          entityId: offer.id,
          beforeState: { status: offer.status },
          afterState: { status: "WITHDRAWN", wasPublished },
        });

        return {
          wasPublished,
          version: offer.version,
          cohortCode: offer.cohort.cohortCode,
          instituteId: offer.instituteId,
          conversationId: offer.cohort.conversationId,
          memberUserIds: offer.cohort.members.map((m) => m.userId),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (result.wasPublished) {
      await postCohortSystemMessage(
        result.conversationId,
        managerUserId,
        `Institute Offer v${result.version} was withdrawn by the institute manager. Cohort members may await a revised offer.`
      );
      await Promise.allSettled(
        result.memberUserIds.map((uid) =>
          notifyUser(
            uid,
            "NOTICE",
            `Offer v${result.version} Withdrawn (${result.cohortCode})`,
            `The institute withdrew Offer v${result.version}. Any unredeemed vouchers from v${result.version} were revoked.`,
            result.cohortCode
          )
        )
      );
    }

    revalidatePath(`/batchbuy/${result.cohortCode}`);
    revalidatePath(`/manager/${result.instituteId}/batchbuy/offers`);

    return { success: true };
  } catch (err: unknown) {
    console.error("Failed to withdraw cohort offer:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to withdraw offer.",
    };
  }
}

/**
 * Initiates verifiable parental/guardian consent for a minor cohort member by dispatching
 * a cryptographic 6-digit OTP to the registered parentPhone (WhatsApp/Notification) and recording
 * parentNotifiedAt separately from parentConsentVerifiedAt.
 */
export async function requestGuardianConsentOtpAction(cohortId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { success: false, error: "Please log in to request guardian consent." };
  }
  const userId = session.user.id;

  const rateCheck = await checkRateLimit(`guardian-otp-send:${userId}`, 5, 15 * 60 * 1000);
  if (!rateCheck.success) {
    return {
      success: false,
      error:
        rateCheck.message ||
        "Too many guardian OTP requests from your session/IP. Please try again in 15 minutes.",
    };
  }

  const member = await prisma.groupCohortMember.findUnique({
    where: {
      cohortId_userId: { cohortId, userId },
    },
    include: {
      user: { select: { id: true, name: true, isActive: true } },
      cohort: {
        select: {
          cohortCode: true,
          institute: { select: { name: true } },
          batch: { select: { name: true } },
        },
      },
    },
  });

  if (!member || member.stage === "DROPPED") {
    return { success: false, error: "Active cohort membership not found." };
  }

  if (!member.user.isActive) {
    return { success: false, error: "User account is inactive." };
  }

  if (!member.isMinor) {
    return { success: false, error: "Guardian consent OTP is only required for minor applicants." };
  }

  if (member.parentConsentVerifiedAt) {
    return {
      success: false,
      error: "Guardian consent has already been verified for this cohort membership.",
    };
  }

  const parentPhone = normalizeIndianPhone(member.parentPhone);
  if (!parentPhone || !member.parentName?.trim()) {
    return {
      success: false,
      error: "Parent/guardian name and valid 10-digit Indian mobile number are missing on your cohort record.",
    };
  }

  // Cooldown guard: prevent rapid SMS/WhatsApp spam (< 45 seconds)
  if (member.parentNotifiedAt && Date.now() - member.parentNotifiedAt.getTime() < 45_000) {
    return {
      success: false,
      error: "Guardian verification code was sent recently. Please wait 45 seconds before requesting another.",
    };
  }

  const identifier = `batchbuy:guardian-consent:${member.id}`;
  const existingChallenge = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });

  const nowMs = Date.now();
  let nextSendCount = 1;
  let windowStartedAt = new Date(nowMs).toISOString();
  if (existingChallenge) {
    try {
      const prev = JSON.parse(existingChallenge.value) as {
        sendCount?: number;
        windowStartedAt?: string;
      };
      const prevWindowMs = prev.windowStartedAt ? Date.parse(prev.windowStartedAt) : NaN;
      if (!Number.isNaN(prevWindowMs) && nowMs - prevWindowMs < 60 * 60 * 1000) {
        nextSendCount = (prev.sendCount ?? 1) + 1;
        windowStartedAt = prev.windowStartedAt!;
        if (nextSendCount > 5) {
          return {
            success: false,
            error: "Hourly guardian OTP limit (5 requests/hour) reached. Please try again later.",
          };
        }
      }
    } catch {
      // Reset corrupted window metadata safely
    }
  }

  const { otp, salt, otpHash } = createGuardianConsentChallenge(member.id);
  const expiresAt = new Date(nowMs + 15 * 60 * 1000); // 15 minutes

  await prisma.verification.deleteMany({ where: { identifier } });
  await prisma.verification.create({
    data: {
      identifier,
      value: JSON.stringify({
        salt,
        otpHash,
        attempts: 0,
        sendCount: nextSendCount,
        windowStartedAt,
      }),
      expiresAt,
    },
  });

  const now = new Date();
  await prisma.groupCohortMember.update({
    where: { id: member.id },
    data: {
      parentNotifiedAt: now,
    },
  });

  const waMessage =
    `AcademyFind Guardian Consent Verification:\n` +
    `Hello ${member.parentName.trim()}, ${member.user.name || "your ward"} is participating in BatchBuy group admission cohort ${member.cohort.cohortCode} for ${member.cohort.institute.name} (${member.cohort.batch.name}).\n` +
    `Share OTP *${otp}* ONLY if you consent to them reviewing & accepting this commercial group fee offer. Valid for 15 minutes.`;

  const waResult = await sendWhatsAppMessage(parentPhone, waMessage);

  const isDevSimulatedOnly =
    process.env.NODE_ENV !== "production" &&
    !process.env.WHATSAPP_TOKEN &&
    !process.env.WHATSAPP_SERVICE_URL &&
    Boolean((waResult as { simulated?: boolean }).simulated);

  return {
    success: true,
    maskedParentPhone: maskPhone(parentPhone),
    expiresInMinutes: 15,
    simulatedDelivery: Boolean((waResult as { simulated?: boolean }).simulated),
    devOtpHint: isDevSimulatedOnly ? otp : undefined,
  };
}

/**
 * Verifies the guardian's 6-digit OTP challenge and stamps parentConsentVerifiedAt
 * separately from parentNotifiedAt.
 */
export async function verifyGuardianConsentOtpAction(rawInput: {
  cohortId: string;
  otp: string;
  guardianConfirmationAccepted: boolean;
}) {
  const parsed = VerifyGuardianConsentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid guardian verification details.",
    };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { success: false, error: "Please log in to verify guardian consent." };
  }
  const userId = session.user.id;
  const { cohortId, otp } = parsed.data;

  const rateCheck = await checkRateLimit(`guardian-otp-verify:${userId}`, 10, 15 * 60 * 1000);
  if (!rateCheck.success) {
    return {
      success: false,
      error:
        rateCheck.message ||
        "Too many OTP verification attempts. Please wait 15 minutes before trying again.",
    };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const member = await tx.groupCohortMember.findUnique({
          where: {
            cohortId_userId: { cohortId, userId },
          },
          include: {
            cohort: { select: { cohortCode: true, instituteId: true } },
          },
        });

        if (!member || member.stage === "DROPPED") {
          return { success: false as const, error: "Active cohort membership not found." };
        }

        if (!member.isMinor) {
          return {
            success: false as const,
            error: "Guardian consent verification is only required for minor applicants.",
          };
        }

        await tx.$queryRaw`SELECT id FROM "group_cohort_member" WHERE id = ${member.id} FOR UPDATE`;

        if (member.parentConsentVerifiedAt) {
          return {
            success: false as const,
            error: "Guardian consent has already been verified. Duplicate OTP replay is not permitted.",
          };
        }

        const identifier = `batchbuy:guardian-consent:${member.id}`;
        const challenge = await tx.verification.findFirst({
          where: { identifier },
          orderBy: { createdAt: "desc" },
        });

        if (!challenge || challenge.expiresAt <= now) {
          return {
            success: false as const,
            error: "Guardian consent OTP is missing or expired. Please request a new code.",
          };
        }

        let payload: {
          salt: string;
          otpHash: string;
          attempts: number;
          sendCount?: number;
          windowStartedAt?: string;
        };
        try {
          payload = JSON.parse(challenge.value) as {
            salt: string;
            otpHash: string;
            attempts: number;
            sendCount?: number;
            windowStartedAt?: string;
          };
        } catch {
          return {
            success: false as const,
            error: "Corrupted verification challenge. Please request a new OTP.",
          };
        }

        if (payload.attempts >= 5) {
          return {
            success: false as const,
            error: "Maximum OTP attempts exceeded. Please request a new guardian consent OTP.",
          };
        }

        const isValidOtp = verifyGuardianOtpHash(payload.salt, otp, payload.otpHash, member.id);
        if (!isValidOtp) {
          const nextAttempts = payload.attempts + 1;
          await tx.verification.update({
            where: { id: challenge.id },
            data: {
              value: JSON.stringify({
                salt: payload.salt,
                otpHash: payload.otpHash,
                attempts: nextAttempts,
                sendCount: payload.sendCount,
                windowStartedAt: payload.windowStartedAt,
              }),
            },
          });
          return {
            success: false as const,
            error:
              nextAttempts >= 5
                ? "Incorrect OTP. Maximum attempts reached; please request a fresh guardian OTP."
                : `Incorrect guardian OTP. ${5 - nextAttempts} attempt(s) remaining.`,
          };
        }

        await tx.verification.deleteMany({ where: { identifier } });

        await tx.groupCohortMember.update({
          where: { id: member.id },
          data: {
            parentConsentVerifiedAt: now,
            parentConsentMethod: "GUARDIAN_WHATSAPP_OTP",
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: member.cohort.instituteId,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "GUARDIAN_CONSENT_VERIFIED",
          entityType: "GroupCohortMember",
          entityId: member.id,
          afterState: {
            cohortId: member.cohortId,
            method: "GUARDIAN_WHATSAPP_OTP",
          },
        });

        return {
          success: true as const,
          cohortCode: member.cohort.cohortCode,
          parentConsentVerifiedAt: now.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (result.success) {
      revalidatePath(`/batchbuy/${result.cohortCode}`);
    }

    return result;
  } catch (err: unknown) {
    console.error("Failed to verify guardian consent OTP:", err);
    return {
      success: false,
      error: "Unable to verify guardian consent right now. Please try again.",
    };
  }
}

/**
 * Independent student decision to ACCEPT or DECLINE an active cohort offer.
 * - Strictly individual: never uses group majority voting.
 * - Revalidates account eligibility, 3-level admission intent & verified guardian consent for minors.
 * - Atomically creates an immutable, cryptographically bound AdmissionVoucher on ACCEPT.
 * - Evaluates minAcceptanceQuorum separately from minAdmissionQuorum and unlocks PENDING_QUORUM -> ACTIVE
 *   vouchers atomically when minAcceptanceQuorum is met.
 */
export async function respondToCohortOfferAction(rawInput: RespondToOfferInput) {
  const parsed = RespondToOfferSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid offer response payload.",
    };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { success: false as const, error: "Please log in to respond to this offer." };
  }

  const userId = session.user.id;
  const { cohortId, offerId, decision, declineReason } = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // Consistent lock ordering: "user" -> "group_cohort_member" -> "group_cohort_offer"
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, isActive: true, name: true, phoneVerified: true },
        });
        if (!user || !user.isActive) {
          return {
            success: false as const,
            error: "Your account is inactive or ineligible for admission offers.",
          };
        }

        const member = await tx.groupCohortMember.findUnique({
          where: {
            cohortId_userId: { cohortId, userId },
          },
        });
        if (!member || member.stage === "DROPPED") {
          return {
            success: false as const,
            error: "You must be an active member of this cohort to respond to an offer.",
          };
        }

        await tx.$queryRaw`SELECT id FROM "group_cohort_member" WHERE id = ${member.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${offerId} FOR UPDATE`;

        const offer = await tx.cohortOffer.findUnique({
          where: { id: offerId },
          include: {
            cohort: {
              select: {
                id: true,
                cohortCode: true,
                status: true,
                instituteId: true,
                batchId: true,
                conversationId: true,
              },
            },
            institute: { select: { name: true } },
            batch: { select: { name: true } },
          },
        });

        if (!offer || offer.cohortId !== cohortId) {
          return { success: false as const, error: "Cohort offer not found." };
        }

        if (["DRAFT", "SUPERSEDED", "WITHDRAWN"].includes(offer.status)) {
          return {
            success: false as const,
            error: `This offer (v${offer.version}) is ${offer.status.toLowerCase()} and cannot accept responses.`,
          };
        }

        if (["CANCELLED", "EXPIRED", "COMPLETED"].includes(offer.cohort.status)) {
          return {
            success: false as const,
            error: `This cohort is ${offer.cohort.status.toLowerCase()} and no longer active.`,
          };
        }

        // Persist expiry cleanly for offer + any PENDING_QUORUM vouchers if acceptance deadline elapsed
        if (offer.status === "EXPIRED" || offer.offerExpiresAt <= now) {
          await expireElapsedOfferAndVouchersTx(tx, offer.id);
          return {
            success: false as const,
            error: `Offer v${offer.version} expired on ${offer.offerExpiresAt.toLocaleDateString("en-IN")} and can no longer be accepted or declined.`,
          };
        }

        if (offer.voucherExpiresAt <= now) {
          return {
            success: false as const,
            error: "The voucher validity window for this offer has elapsed.",
          };
        }

        const existingDecision = await tx.groupOfferDecision.findUnique({
          where: {
            offerId_cohortMemberId: {
              offerId: offer.id,
              cohortMemberId: member.id,
            },
          },
        });

        // Idempotent handling / prevention of duplicate issuance or conflicting overwrite
        if (existingDecision?.decision === "ACCEPTED") {
          if (decision === "DECLINED") {
            return {
              success: false as const,
              error:
                "You have already accepted this offer and hold a bound admission voucher. Contact the institute manager if you cannot enroll.",
            };
          }

          const existingVoucher = await tx.admissionVoucher.findUnique({
            where: {
              offerId_cohortMemberId: {
                offerId: offer.id,
                cohortMemberId: member.id,
              },
            },
          });

          const currentAcceptedCount = await tx.groupOfferDecision.count({
            where: {
              offerId: offer.id,
              decision: "ACCEPTED",
              cohortMember: { stage: { not: "DROPPED" } },
            },
          });

          return {
            success: true as const,
            alreadyDecided: true,
            decision: "ACCEPTED" as const,
            quorumJustMet: false,
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
            voucher: existingVoucher
              ? serializeVoucherRecord({
                  voucher: existingVoucher,
                  cohortCode: offer.cohort.cohortCode,
                  offerStatus: offer.status as CohortOfferStatusType,
                  offerExpiresAt: offer.offerExpiresAt,
                  acceptedCount: currentAcceptedCount,
                  now,
                })
              : null,
          };
        }

        if (existingDecision?.decision === "DECLINED" && decision === "DECLINED") {
          return {
            success: true as const,
            alreadyDecided: true,
            decision: "DECLINED" as const,
            quorumJustMet: false,
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
            voucher: null,
          };
        }

        if (decision === "DECLINED") {
          await tx.groupOfferDecision.create({
            data: {
              offerId: offer.id,
              cohortId,
              cohortMemberId: member.id,
              userId,
              decision: "DECLINED",
              declineReason: declineReason?.trim() || null,
              revalidatedIntentAt: member.explicitIntentAt ?? now,
              guardianConsentVerifiedAt: member.parentConsentVerifiedAt,
              decidedAt: now,
            },
          });

          await tx.groupCohortMember.update({
            where: { id: member.id },
            data: { stage: "OFFER_DECLINED" },
          });

          await writeBatchBuyAuditLogTx(tx, {
            instituteId: offer.instituteId,
            actorUserId: userId,
            actorRole: "STUDENT",
            action: "OFFER_DECISION_SUBMITTED",
            entityType: "CohortOffer",
            entityId: offer.id,
            reason: declineReason?.trim() || null,
            afterState: {
              cohortMemberId: member.id,
              decision: "DECLINED",
            },
          });

          return {
            success: true as const,
            alreadyDecided: false,
            decision: "DECLINED" as const,
            quorumJustMet: false,
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
            voucher: null,
          };
        }

        // === decision === "ACCEPTED" ===
        // Requirement 6: Revalidate student eligibility & explicit admission intent
        const intentState = resolveMemberIntentState({
          phoneVerified: user.phoneVerified,
          profileConfirmed: member.profileConfirmed,
          explicitIntentAt: member.explicitIntentAt,
        });

        if (!user.phoneVerified) {
          return {
            success: false as const,
            error: "Verified mobile number (OTP) is required before accepting an admission offer.",
          };
        }

        if (!intentState.hasCourseConfirmation || !intentState.hasExplicitIntent) {
          return {
            success: false as const,
            error: "Please confirm your explicit course & admission intent before accepting this offer.",
          };
        }

        // Requirement 7: For minors, verified guardian consent is mandatory (notification alone is insufficient)
        if (member.isMinor) {
          if (!member.parentConsentVerifiedAt || !member.parentName?.trim() || !member.parentPhone?.trim()) {
            return {
              success: false as const,
              error:
                "Verified parental/guardian consent (via Guardian OTP) is required before a minor student can accept an offer. Guardian notification alone is not sufficient.",
            };
          }
        }

        // Record or upgrade decision -> ACCEPTED
        const decisionRow = existingDecision
          ? await tx.groupOfferDecision.update({
              where: { id: existingDecision.id },
              data: {
                decision: "ACCEPTED",
                declineReason: null,
                revalidatedIntentAt: now,
                guardianConsentVerifiedAt: member.parentConsentVerifiedAt,
                decidedAt: now,
              },
            })
          : await tx.groupOfferDecision.create({
              data: {
                offerId: offer.id,
                cohortId,
                cohortMemberId: member.id,
                userId,
                decision: "ACCEPTED",
                revalidatedIntentAt: now,
                guardianConsentVerifiedAt: member.parentConsentVerifiedAt,
                decidedAt: now,
              },
            });

        // Recompute accepted count including this acceptance (Requirement 4: separate from minAdmissionQuorum)
        const acceptedCount = await tx.groupOfferDecision.count({
          where: {
            offerId: offer.id,
            decision: "ACCEPTED",
            cohortMember: { stage: { not: "DROPPED" } },
          },
        });

        const quorumReached = acceptedCount >= offer.minAcceptanceQuorum;
        const quorumJustMet = quorumReached && offer.status === "PUBLISHED";
        const newOfferStatus: CohortOfferStatusType = quorumReached
          ? "QUORUM_MET"
          : (offer.status as CohortOfferStatusType);

        // Requirement 8 & 9: Cryptographically secure individual voucher bound 1-to-1
        const secrets = generateVoucherArtifacts({
          offerId: offer.id,
          offerVersion: offer.version,
          cohortId: offer.cohortId,
          cohortMemberId: member.id,
          userId,
          instituteId: offer.instituteId,
          batchId: offer.batchId,
        });

        const initialVoucherStatus: VoucherStatusType = quorumReached
          ? "ACTIVE"
          : "PENDING_QUORUM";

        const createdVoucher = await tx.admissionVoucher.create({
          data: {
            voucherCode: secrets.voucherCode,
            tokenHash: secrets.tokenHash,
            securityNonce: secrets.securityNonce,
            offerId: offer.id,
            offerVersion: offer.version,
            decisionId: decisionRow.id,
            cohortId: offer.cohortId,
            cohortMemberId: member.id,
            userId,
            instituteId: offer.instituteId,
            batchId: offer.batchId,
            status: initialVoucherStatus,
            baseFee: offer.baseFee,
            registrationFeeOriginal: offer.registrationFeeOriginal,
            waiveRegistration: offer.waiveRegistration,
            discountPercentage: offer.discountPercentage,
            discountAmount: offer.discountAmount,
            netPayableTuition: offer.netPayableTuition,
            includedPerks: offer.includedPerks,
            fallbackPolicy: offer.fallbackPolicy,
            minAcceptanceQuorumSnapshot: offer.minAcceptanceQuorum,
            minAdmissionQuorumSnapshot: offer.minAdmissionQuorum,
            studentNameSnapshot: user.name?.trim() || "Student Aspirant",
            instituteNameSnapshot: offer.institute.name,
            batchNameSnapshot: offer.batch.name,
            issuedAt: now,
            activatedAt: quorumReached ? now : null,
            expiresAt: offer.voucherExpiresAt,
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: offer.instituteId,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "OFFER_DECISION_SUBMITTED",
          entityType: "CohortOffer",
          entityId: offer.id,
          afterState: {
            cohortMemberId: member.id,
            decision: "ACCEPTED",
            voucherId: createdVoucher.id,
            quorumReached,
          },
        });

        // Update current member stage cleanly & promote peer vouchers if quorum just met
        if (quorumJustMet) {
          await tx.cohortOffer.update({
            where: { id: offer.id },
            data: {
              status: "QUORUM_MET",
              quorumMetAt: now,
            },
          });

          await tx.groupAdmissionCohort.update({
            where: { id: offer.cohortId },
            data: { status: "ADMISSION_OPEN" },
          });

          await tx.admissionVoucher.updateMany({
            where: {
              offerId: offer.id,
              status: "PENDING_QUORUM",
            },
            data: {
              status: "ACTIVE",
              activatedAt: now,
            },
          });

          const acceptedDecisions = await tx.groupOfferDecision.findMany({
            where: {
              offerId: offer.id,
              decision: "ACCEPTED",
              cohortMember: { stage: { not: "DROPPED" } },
            },
            select: { cohortMemberId: true, userId: true },
          });

          const memberIdsToPromote = acceptedDecisions.map((d) => d.cohortMemberId);
          if (memberIdsToPromote.length > 0) {
            await tx.groupCohortMember.updateMany({
              where: { id: { in: memberIdsToPromote } },
              data: { stage: "VOUCHER_ISSUED" },
            });
          }

          return {
            success: true as const,
            alreadyDecided: false,
            decision: "ACCEPTED" as const,
            quorumJustMet: true,
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
            instituteName: offer.institute.name,
            batchName: offer.batch.name,
            conversationId: offer.cohort.conversationId,
            offerVersion: offer.version,
            minAcceptanceQuorum: offer.minAcceptanceQuorum,
            minAdmissionQuorum: offer.minAdmissionQuorum,
            acceptedUserIdsToNotify: acceptedDecisions.map((d) => d.userId),
            voucher: serializeVoucherRecord({
              voucher: createdVoucher,
              cohortCode: offer.cohort.cohortCode,
              offerStatus: newOfferStatus,
              offerExpiresAt: offer.offerExpiresAt,
              acceptedCount,
              now,
            }),
          };
        }

        await tx.groupCohortMember.update({
          where: { id: member.id },
          data: { stage: quorumReached ? "VOUCHER_ISSUED" : "OFFER_ACCEPTED" },
        });

        return {
          success: true as const,
          alreadyDecided: false,
          decision: "ACCEPTED" as const,
          quorumJustMet: false,
          cohortCode: offer.cohort.cohortCode,
          instituteId: offer.instituteId,
          instituteName: offer.institute.name,
          batchName: offer.batch.name,
          conversationId: offer.cohort.conversationId,
          offerVersion: offer.version,
          minAcceptanceQuorum: offer.minAcceptanceQuorum,
          minAdmissionQuorum: offer.minAdmissionQuorum,
          acceptedUserIdsToNotify: [userId],
          voucher: serializeVoucherRecord({
            voucher: createdVoucher,
            cohortCode: offer.cohort.cohortCode,
            offerStatus: newOfferStatus,
            offerExpiresAt: offer.offerExpiresAt,
            acceptedCount,
            now,
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (!result.success) {
      return result;
    }

    if (result.decision === "ACCEPTED" && !result.alreadyDecided && result.voucher) {
      if (result.quorumJustMet && "conversationId" in result) {
        await postCohortSystemMessage(
          result.conversationId ?? null,
          userId,
          `Acceptance Quorum Reached (${result.minAcceptanceQuorum}/${result.minAcceptanceQuorum} students accepted Offer v${result.offerVersion})! All bound BatchBuy vouchers are now ACTIVE for direct admission at ${result.instituteName}.`
        );

        await Promise.allSettled(
          (result.acceptedUserIdsToNotify ?? []).map((uid) =>
            notifyUser(
              uid,
              "NOTICE",
              `Voucher Activated for ${result.cohortCode}!`,
              `Acceptance quorum (${result.minAcceptanceQuorum}) is unlocked! Your admission voucher for ${result.instituteName} (${result.batchName}) is now ACTIVE.`,
              result.cohortCode
            )
          )
        );
      } else {
        await notifyUser(
          userId,
          "NOTICE",
          `Offer Accepted — Voucher ${result.voucher.voucherCode}`,
          result.voucher.isRedeemable
            ? `Your ACTIVE BatchBuy voucher ${result.voucher.voucherCode} is ready for center admission.`
            : `Your bound voucher ${result.voucher.voucherCode} is issued and awaiting acceptance quorum (${result.voucher.acceptedCount}/${result.voucher.minAcceptanceQuorum}).`,
          result.cohortCode
        );
      }
    }

    revalidatePath(`/batchbuy/${result.cohortCode}`);
    revalidatePath(`/manager/${result.instituteId}/batchbuy/offers`);

    return result;
  } catch (err: unknown) {
    console.error("Failed to respond to BatchBuy offer:", err);
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2034" ||
        (err.code === "P2010" &&
          (err.message.includes("40001") ||
            err.message.toLowerCase().includes("could not serialize access"))))
    ) {
      return {
        success: false as const,
        error: "Concurrent offer response detected. Please try again in a moment.",
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        success: false as const,
        error: "Duplicate voucher issuance was prevented. Please refresh to view your issued pass.",
      };
    }
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to submit offer response.",
    };
  }
}
