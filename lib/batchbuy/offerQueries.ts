import { prisma } from "@/lib/prisma";
import { verifyInstituteManagerAccess } from "./slabActions";
import { resolveEffectiveDiscountSlabs, type EffectiveDiscountSlab } from "./slabResolver";
import { maskPhone, resolveMemberIntentState } from "./cohortValidation";
import {
  evaluateVoucherEligibility,
  type CohortOfferStatusType,
  type OfferDecisionTypeValue,
  type SerializedCohortOfferSummary,
  type VoucherStatusType,
} from "./offerValidation";
import type { SerializedIssuedVoucher } from "./offerActions";
import { computeVoucherQrPayload } from "./voucherCrypto";
import type { SlabFallbackPolicyType } from "./slabValidation";
import { getInstituteAgreementsSummary } from "./agreementActions";

export interface StudentGuardianConsentStatus {
  isMinor: boolean;
  hasParentDetails: boolean;
  maskedParentPhone: string | null;
  parentNotifiedAt: string | null;
  parentConsentVerifiedAt: string | null;
  parentConsentMethod: string | null;
}

export interface StudentEligibilitySummary {
  accountActive: boolean;
  phoneVerified: boolean;
  hasCourseConfirmation: boolean;
  hasExplicitIntent: boolean;
  isFullyIntentVerified: boolean;
}

export interface StudentOfferWorkspaceData {
  activeOffer: SerializedCohortOfferSummary | null;
  pastOffers: SerializedCohortOfferSummary[];
  myDecision: {
    decision: OfferDecisionTypeValue;
    decidedAt: string;
    declineReason: string | null;
  } | null;
  myVoucher: SerializedIssuedVoucher | null;
  guardianConsent: StudentGuardianConsentStatus | null;
  eligibilitySummary: StudentEligibilitySummary | null;
}

function serializeOfferSummary(
  offer: {
    id: string;
    cohortId: string;
    version: number;
    status: string;
    sourceSlabId: string | null;
    title: string;
    baseFee: unknown;
    registrationFeeOriginal: unknown;
    waiveRegistration: boolean;
    discountPercentage: unknown;
    discountAmount: unknown;
    netPayableTuition: unknown;
    includedPerks: string[];
    fallbackPolicy: string;
    paymentTerms: string | null;
    additionalNotes: string | null;
    minAcceptanceQuorum: number;
    minAdmissionQuorum: number;
    offerExpiresAt: Date;
    voucherExpiresAt: Date;
    publishedAt: Date | null;
    quorumMetAt: Date | null;
    decisions: {
      decision: string;
      cohortMember: { stage: string };
    }[];
    vouchers: {
      status: string;
    }[];
  },
  now = new Date()
): SerializedCohortOfferSummary {
  const acceptedCount = offer.decisions.filter(
    (d) => d.decision === "ACCEPTED" && d.cohortMember.stage !== "DROPPED"
  ).length;
  const declinedCount = offer.decisions.filter(
    (d) => d.decision === "DECLINED" && d.cohortMember.stage !== "DROPPED"
  ).length;

  let effectiveStatus = offer.status as CohortOfferStatusType;
  if (effectiveStatus === "PUBLISHED" && offer.offerExpiresAt <= now) {
    effectiveStatus = "EXPIRED";
  }

  const activeVoucherCount = offer.vouchers.filter((v) => v.status === "ACTIVE").length;
  const pendingQuorumVoucherCount =
    effectiveStatus === "EXPIRED"
      ? 0
      : offer.vouchers.filter((v) => v.status === "PENDING_QUORUM").length;

  const baseFee = Number(offer.baseFee);
  const registrationFeeOriginal = Number(offer.registrationFeeOriginal);
  const discountAmount = Number(offer.discountAmount);
  const netPayableTuition = Number(offer.netPayableTuition);
  const totalSavings =
    discountAmount + (offer.waiveRegistration ? registrationFeeOriginal : 0);

  return {
    id: offer.id,
    cohortId: offer.cohortId,
    version: offer.version,
    status: offer.status as CohortOfferStatusType,
    effectiveStatus,
    sourceSlabId: offer.sourceSlabId,
    title: offer.title,
    baseFee,
    registrationFeeOriginal,
    waiveRegistration: offer.waiveRegistration,
    discountPercentage: Number(offer.discountPercentage),
    discountAmount,
    netPayableTuition,
    totalSavings,
    includedPerks: offer.includedPerks,
    fallbackPolicy: offer.fallbackPolicy as SlabFallbackPolicyType,
    paymentTerms: offer.paymentTerms,
    additionalNotes: offer.additionalNotes,
    minAcceptanceQuorum: offer.minAcceptanceQuorum,
    minAdmissionQuorum: offer.minAdmissionQuorum,
    acceptedCount,
    declinedCount,
    activeVoucherCount,
    pendingQuorumVoucherCount,
    offerExpiresAt: offer.offerExpiresAt.toISOString(),
    voucherExpiresAt: offer.voucherExpiresAt.toISOString(),
    publishedAt: offer.publishedAt ? offer.publishedAt.toISOString() : null,
    quorumMetAt: offer.quorumMetAt ? offer.quorumMetAt.toISOString() : null,
  };
}

/**
 * Synchronizes any elapsed PUBLISHED offers and their PENDING_QUORUM vouchers to EXPIRED
 * in PostgreSQL and in the loaded in-memory offer list.
 */
async function syncExpiredOffersWithPendingVouchers<
  T extends {
    id: string;
    status: string;
    offerExpiresAt: Date;
    vouchers: { status: string; revokeReason?: string | null }[];
  }
>(offers: T[], now: Date): Promise<void> {
  const staleOffers = offers.filter(
    (o) =>
      (o.status === "PUBLISHED" && o.offerExpiresAt <= now) ||
      (o.status === "EXPIRED" && o.vouchers.some((v) => v.status === "PENDING_QUORUM"))
  );
  if (staleOffers.length === 0) return;

  const staleIds = staleOffers.map((o) => o.id);
  const revokeReason =
    "Offer acceptance deadline elapsed before reaching minimum acceptance quorum.";

  if (typeof prisma.$transaction === "function") {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.cohortOffer.updateMany({
          where: {
            id: { in: staleIds },
            status: "PUBLISHED",
            offerExpiresAt: { lte: now },
          },
          data: { status: "EXPIRED" },
        });
        await tx.admissionVoucher.updateMany({
          where: {
            offerId: { in: staleIds },
            status: "PENDING_QUORUM",
          },
          data: {
            status: "EXPIRED",
            revokeReason,
          },
        });
      });
    } catch {
      // Fall back to deterministic in-memory expiration if read-only replica or partial mock
    }
  }

  for (const offer of staleOffers) {
    if (offer.status === "PUBLISHED" && offer.offerExpiresAt <= now) {
      offer.status = "EXPIRED";
    }
    for (const voucher of offer.vouchers) {
      if (voucher.status === "PENDING_QUORUM") {
        voucher.status = "EXPIRED";
        if ("revokeReason" in voucher) {
          voucher.revokeReason = revokeReason;
        }
      }
    }
  }
}

/**
 * Fetches student-facing Slice 3 offer state, individual decision, bound private voucher,
 * and minor guardian consent status for the cohort room UI.
 */
export async function getStudentCohortOfferWorkspace(
  cohortId: string,
  cohortCode: string,
  viewerUserId: string | null
): Promise<StudentOfferWorkspaceData> {
  const now = new Date();

  const offers = await prisma.cohortOffer.findMany({
    where: {
      cohortId,
      status: { not: "DRAFT" },
    },
    orderBy: { version: "desc" },
    include: {
      decisions: {
        select: {
          userId: true,
          decision: true,
          decidedAt: true,
          declineReason: true,
          cohortMember: { select: { stage: true } },
        },
      },
      vouchers: {
        select: {
          id: true,
          voucherCode: true,
          securityNonce: true,
          offerId: true,
          offerVersion: true,
          cohortId: true,
          cohortMemberId: true,
          userId: true,
          instituteId: true,
          batchId: true,
          status: true,
          baseFee: true,
          registrationFeeOriginal: true,
          waiveRegistration: true,
          discountPercentage: true,
          discountAmount: true,
          netPayableTuition: true,
          includedPerks: true,
          fallbackPolicy: true,
          minAcceptanceQuorumSnapshot: true,
          minAdmissionQuorumSnapshot: true,
          studentNameSnapshot: true,
          instituteNameSnapshot: true,
          batchNameSnapshot: true,
          issuedAt: true,
          activatedAt: true,
          expiresAt: true,
          revokedAt: true,
          revokeReason: true,
          redeemedAt: true,
          settlementState: true,
          disclosedFallbackFee: true,
          settledTuition: true,
          fallbackConsentRequestedAt: true,
          fallbackConsentRespondedAt: true,
          fallbackConsentAccepted: true,
          admissionRecord: {
            select: {
              status: true,
              directRefundRequiredAmount: true,
              directRefundStatus: true,
            },
          },
        },
      },
    },
  });

  await syncExpiredOffersWithPendingVouchers(offers, now);

  const activeRaw =
    offers.find((o) => o.status === "QUORUM_MET" || o.status === "PUBLISHED") ??
    offers.find((o) => o.status === "EXPIRED") ??
    null;

  const activeOffer = activeRaw ? serializeOfferSummary(activeRaw, now) : null;
  const pastOffers = offers
    .filter((o) => !activeRaw || o.id !== activeRaw.id)
    .map((o) => serializeOfferSummary(o, now));

  let myDecision: StudentOfferWorkspaceData["myDecision"] = null;
  let myVoucher: SerializedIssuedVoucher | null = null;
  let guardianConsent: StudentGuardianConsentStatus | null = null;
  let eligibilitySummary: StudentEligibilitySummary | null = null;

  if (viewerUserId) {
    const member = await prisma.groupCohortMember.findUnique({
      where: {
        cohortId_userId: { cohortId, userId: viewerUserId },
      },
      select: {
        id: true,
        stage: true,
        profileConfirmed: true,
        explicitIntentAt: true,
        isMinor: true,
        parentName: true,
        parentPhone: true,
        parentNotifiedAt: true,
        parentConsentVerifiedAt: true,
        parentConsentMethod: true,
        user: {
          select: {
            isActive: true,
            phoneVerified: true,
          },
        },
      },
    });

    if (member && member.stage !== "DROPPED") {
      const intent = resolveMemberIntentState({
        phoneVerified: member.user.phoneVerified,
        profileConfirmed: member.profileConfirmed,
        explicitIntentAt: member.explicitIntentAt,
      });
      eligibilitySummary = {
        accountActive: member.user.isActive,
        phoneVerified: member.user.phoneVerified,
        hasCourseConfirmation: intent.hasCourseConfirmation,
        hasExplicitIntent: intent.hasExplicitIntent,
        isFullyIntentVerified: intent.isFullyIntentVerified,
      };
      guardianConsent = {
        isMinor: member.isMinor,
        hasParentDetails: Boolean(member.parentName?.trim() && member.parentPhone?.trim()),
        maskedParentPhone: maskPhone(member.parentPhone),
        parentNotifiedAt: member.parentNotifiedAt
          ? member.parentNotifiedAt.toISOString()
          : null,
        parentConsentVerifiedAt: member.parentConsentVerifiedAt
          ? member.parentConsentVerifiedAt.toISOString()
          : null,
        parentConsentMethod: member.parentConsentMethod,
      };

      if (activeRaw) {
        const myDecRaw = activeRaw.decisions.find((d) => d.userId === viewerUserId);
        if (myDecRaw) {
          myDecision = {
            decision: myDecRaw.decision as OfferDecisionTypeValue,
            decidedAt: myDecRaw.decidedAt.toISOString(),
            declineReason: myDecRaw.declineReason,
          };
        }

        const myVouchRaw = activeRaw.vouchers.find((v) => v.userId === viewerUserId);
        if (myVouchRaw) {
          const acceptedCount = activeOffer?.acceptedCount ?? 0;
          const eligibility = evaluateVoucherEligibility({
            status: myVouchRaw.status as VoucherStatusType,
            offerStatus: activeOffer?.effectiveStatus ?? (activeRaw.status as CohortOfferStatusType),
            offerExpiresAt: activeRaw.offerExpiresAt,
            expiresAt: myVouchRaw.expiresAt,
            minAcceptanceQuorum: myVouchRaw.minAcceptanceQuorumSnapshot,
            acceptedCount,
            now,
          });
          const { qrPayload, verificationChecksum } = computeVoucherQrPayload({
            voucherCode: myVouchRaw.voucherCode,
            securityNonce: myVouchRaw.securityNonce,
            offerId: myVouchRaw.offerId,
            offerVersion: myVouchRaw.offerVersion,
            cohortId: myVouchRaw.cohortId,
            cohortMemberId: myVouchRaw.cohortMemberId,
            userId: myVouchRaw.userId,
            instituteId: myVouchRaw.instituteId,
            batchId: myVouchRaw.batchId,
            expiresAtIso: myVouchRaw.expiresAt.toISOString(),
          });

          myVoucher = {
            id: myVouchRaw.id,
            voucherCode: myVouchRaw.voucherCode,
            offerId: myVouchRaw.offerId,
            offerVersion: myVouchRaw.offerVersion,
            cohortId: myVouchRaw.cohortId,
            cohortCode,
            cohortMemberId: myVouchRaw.cohortMemberId,
            userId: myVouchRaw.userId,
            instituteId: myVouchRaw.instituteId,
            batchId: myVouchRaw.batchId,
            status: myVouchRaw.status as VoucherStatusType,
            effectiveStatus: eligibility.effectiveStatus,
            isRedeemable: eligibility.isRedeemable,
            eligibilityReason: eligibility.reason,
            baseFee: Number(myVouchRaw.baseFee),
            registrationFeeOriginal: Number(myVouchRaw.registrationFeeOriginal),
            waiveRegistration: myVouchRaw.waiveRegistration,
            discountPercentage: Number(myVouchRaw.discountPercentage),
            discountAmount: Number(myVouchRaw.discountAmount),
            netPayableTuition: Number(myVouchRaw.netPayableTuition),
            includedPerks: myVouchRaw.includedPerks,
            fallbackPolicy: myVouchRaw.fallbackPolicy as SlabFallbackPolicyType,
            minAcceptanceQuorum: myVouchRaw.minAcceptanceQuorumSnapshot,
            minAdmissionQuorum: myVouchRaw.minAdmissionQuorumSnapshot,
            acceptedCount,
            studentNameSnapshot: myVouchRaw.studentNameSnapshot,
            instituteNameSnapshot: myVouchRaw.instituteNameSnapshot,
            batchNameSnapshot: myVouchRaw.batchNameSnapshot,
            issuedAt: myVouchRaw.issuedAt.toISOString(),
            activatedAt: myVouchRaw.activatedAt
              ? myVouchRaw.activatedAt.toISOString()
              : null,
            expiresAt: myVouchRaw.expiresAt.toISOString(),
            revokedAt: myVouchRaw.revokedAt ? myVouchRaw.revokedAt.toISOString() : null,
            revokeReason: myVouchRaw.revokeReason,
            redeemedAt: myVouchRaw.redeemedAt ? myVouchRaw.redeemedAt.toISOString() : null,
            settlementState: myVouchRaw.settlementState,
            disclosedFallbackFee:
              myVouchRaw.disclosedFallbackFee != null
                ? Number(myVouchRaw.disclosedFallbackFee)
                : null,
            settledTuition:
              myVouchRaw.settledTuition != null ? Number(myVouchRaw.settledTuition) : null,
            fallbackConsentRequestedAt: myVouchRaw.fallbackConsentRequestedAt
              ? myVouchRaw.fallbackConsentRequestedAt.toISOString()
              : null,
            fallbackConsentRespondedAt: myVouchRaw.fallbackConsentRespondedAt
              ? myVouchRaw.fallbackConsentRespondedAt.toISOString()
              : null,
            fallbackConsentAccepted: myVouchRaw.fallbackConsentAccepted,
            admissionStatus: myVouchRaw.admissionRecord?.status ?? null,
            directRefundRequiredAmount:
              myVouchRaw.admissionRecord?.directRefundRequiredAmount != null
                ? Number(myVouchRaw.admissionRecord.directRefundRequiredAmount)
                : null,
            directRefundStatus: myVouchRaw.admissionRecord?.directRefundStatus ?? null,
            qrPayload,
            verificationChecksum,
          };
        }
      }
    }
  }

  return {
    activeOffer,
    pastOffers,
    myDecision,
    myVoucher,
    guardianConsent,
    eligibilitySummary,
  };
}

export interface ManagerCohortOfferItem {
  cohortId: string;
  cohortCode: string;
  title: string;
  status: string;
  examCategory: string;
  targetAcademicYear: number;
  targetSize: number;
  minRequired: number;
  maxCapacity: number;
  activeMemberCount: number;
  verifiedMemberCount: number;
  formingExpiresAt: string;
  batch: {
    id: string;
    name: string;
    courseName: string | null;
    fee: number | null;
    originalFee: number | null;
  };
  slabScope: "BATCH_OVERRIDE" | "INSTITUTE_DEFAULT" | "NONE";
  availableSlabs: EffectiveDiscountSlab[];
  offers: SerializedCohortOfferSummary[];
}

/**
 * Authorized Manager query returning all non-cancelled cohorts for an institute
 * along with offer versions, dual quorum counters, and effective slab presets.
 */
export async function getInstituteBatchBuyOffersData(instituteId: string): Promise<{
  success: boolean;
  error?: string | null;
  cohorts: ManagerCohortOfferItem[];
  agreementsSummary?: Awaited<ReturnType<typeof getInstituteAgreementsSummary>>;
}> {
  const authCheck = await verifyInstituteManagerAccess(instituteId);
  if (!authCheck.authorized) {
    return {
      success: false,
      error: authCheck.error,
      cohorts: [],
    };
  }

  const now = new Date();
  const cohorts = await prisma.groupAdmissionCohort.findMany({
    where: {
      instituteId,
      status: { not: "CANCELLED" },
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          courseName: true,
          fee: true,
          originalFee: true,
        },
      },
      members: {
        where: { stage: { not: "DROPPED" } },
        select: {
          id: true,
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: true,
        },
      },
      offers: {
        orderBy: { version: "desc" },
        include: {
          decisions: {
            select: {
              decision: true,
              cohortMember: { select: { stage: true } },
            },
          },
          vouchers: {
            select: {
              status: true,
            },
          },
        },
      },
    },
  });

  await syncExpiredOffersWithPendingVouchers(
    cohorts.flatMap((c) => c.offers),
    now
  );

  const mapped: ManagerCohortOfferItem[] = await Promise.all(
    cohorts.map(async (cohort) => {
      const slabResolution = await resolveEffectiveDiscountSlabs(
        instituteId,
        cohort.batchId
      );
      const verifiedMemberCount = cohort.members.filter(
        (m) => m.phoneVerified && m.profileConfirmed && m.explicitIntentAt !== null
      ).length;

      return {
        cohortId: cohort.id,
        cohortCode: cohort.cohortCode,
        title: cohort.title,
        status: cohort.status,
        examCategory: cohort.examCategory,
        targetAcademicYear: cohort.targetAcademicYear,
        targetSize: cohort.targetSize,
        minRequired: cohort.minRequired,
        maxCapacity: cohort.maxCapacity,
        activeMemberCount: cohort.members.length,
        verifiedMemberCount,
        formingExpiresAt: cohort.formingExpiresAt.toISOString(),
        batch: {
          id: cohort.batch.id,
          name: cohort.batch.name,
          courseName: cohort.batch.courseName,
          fee: cohort.batch.fee,
          originalFee: cohort.batch.originalFee,
        },
        slabScope: slabResolution.scope,
        availableSlabs: slabResolution.slabs,
        offers: cohort.offers.map((o) => serializeOfferSummary(o, now)),
      };
    })
  );

  const agreementsSummary = await getInstituteAgreementsSummary(instituteId);

  return {
    success: true,
    cohorts: mapped,
    agreementsSummary,
  };
}
