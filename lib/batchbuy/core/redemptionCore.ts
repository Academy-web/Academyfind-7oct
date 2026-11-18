import { prisma } from "@/lib/prisma";
import { Prisma, type CommissionCreditNoteReason } from "@/app/generated/prisma/client";
import { verifyVoucherQrPresentation } from "../voucherCrypto";
import { normalizeIndianPhone } from "../cohortValidation";
import {
  RedeemVoucherSchema,
  RespondFallbackAdjustmentSchema,
  CancelBatchBuyAdmissionSchema,
  computeCommissionBreakdown,
  computeQuorumSettlementPlan,
  parseQrOrVoucherCodeInput,
  type RedeemVoucherInput,
} from "../commissionMath";
import {
  writeBatchBuyAuditLogTx,
  resolveQualifyingLowerSlabPctTx,
} from "../redemptionAuth";
import type { SlabFallbackPolicyType } from "../slabValidation";
import { createAdmissionFromPipelineTx } from "@/lib/instituteSalesManager/admissionPipeline";
import { reverseCommissionEntryTx } from "./commissionCore";

function isSerializationError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2034" ||
      (err.code === "P2010" &&
        (err.message.includes("40001") ||
          err.message.toLowerCase().includes("could not serialize access"))))
  );
}

export interface RedemptionActorContext {
  userId: string;
  userName: string;
  actorRole: string;
  isIsmRole: boolean;
}

/**
 * Checks whether the student already has an active direct CRM or BatchBuy admission at
 * the target institute+batch so counter redemption cannot create duplicate admissions/commissions.
 */
async function findExistingActiveStudentAdmissionTx(
  tx: Prisma.TransactionClient,
  params: {
    instituteId: string;
    batchId: string;
    phone?: string | null;
    email?: string | null;
  }
) {
  const normPhone = normalizeIndianPhone(params.phone);
  const normEmail = params.email?.trim().toLowerCase() || null;
  if (!normPhone && !normEmail) return null;

  const candidates = await tx.admissionRecord.findMany({
    where: {
      instituteId: params.instituteId,
      status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] },
      OR: [{ batchId: params.batchId }, { batchId: null }],
      enquiry: {
        OR: [
          ...(normPhone ? [{ phone: { contains: normPhone } }] : []),
          ...(normEmail ? [{ email: normEmail }] : []),
        ],
      },
    },
    include: {
      enquiry: { select: { phone: true, email: true, source: true } },
    },
    take: 5,
  });

  return (
    candidates.find((adm) => {
      const admPhone = normalizeIndianPhone(adm.enquiry.phone);
      const admEmail = adm.enquiry.email?.trim().toLowerCase() || null;
      const phoneMatch = Boolean(normPhone && admPhone === normPhone);
      const emailMatch = Boolean(normEmail && admEmail === normEmail);
      return phoneMatch || emailMatch;
    }) ?? null
  );
}

/**
 * Transactional core for BatchBuy counter voucher redemption.
 */
export async function redeemBatchBuyVoucherCore(
  rawInput: RedeemVoucherInput,
  authCtx: RedemptionActorContext
) {
  const parsed = RedeemVoucherSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid voucher redemption payload.",
    };
  }

  const input = parsed.data;
  const parsedInput = parseQrOrVoucherCodeInput(input.qrPayloadOrCode);

  const lookup = await prisma.admissionVoucher.findUnique({
    where: { voucherCode: parsedInput.voucherCode },
    select: { id: true, instituteId: true, offerId: true, cohortId: true },
  });

  if (!lookup) {
    return {
      success: false as const,
      error: `Voucher ${parsedInput.voucherCode} not found.`,
    };
  }
  if (lookup.instituteId !== input.instituteId) {
    return {
      success: false as const,
      error: "Voucher belongs to another institute and cannot be redeemed at this center.",
    };
  }

  const actorUserId = authCtx.userId;
  const actorRole = authCtx.actorRole || "INSTITUTE_MANAGER";
  const actorName = authCtx.userName || "Institute Counter Staff";

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "admission_voucher" WHERE id = ${lookup.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${lookup.offerId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${lookup.cohortId} FOR UPDATE`;

        const voucher = await tx.admissionVoucher.findUnique({
          where: { id: lookup.id },
          include: {
            user: { select: { id: true, name: true, phone: true, email: true } },
            cohort: { select: { id: true, cohortCode: true, title: true } },
            offer: {
              select: {
                id: true,
                status: true,
                publishedAt: true,
                minAdmissionQuorum: true,
                commissionAgreementId: true,
                commissionRatePctSnapshot: true,
                holdingPeriodDaysSnapshot: true,
                attributionWindowDaysSnapshot: true,
                commissionAgreement: {
                  select: { gstRatePct: true, commissionRatePct: true },
                },
              },
            },
            admissionRecord: { select: { id: true } },
          },
        });

        if (!voucher) throw new Error("Voucher not found.");

        if (voucher.status === "REDEEMED" || voucher.admissionRecord) {
          return {
            success: false as const,
            error: `Voucher ${voucher.voucherCode} has already been redeemed.`,
          };
        }
        if (voucher.status !== "ACTIVE") {
          return {
            success: false as const,
            error: `Voucher ${voucher.voucherCode} is ${voucher.status} and cannot be redeemed.`,
          };
        }
        if (voucher.expiresAt <= now) {
          await tx.admissionVoucher.update({
            where: { id: voucher.id },
            data: { status: "EXPIRED" },
          });
          return {
            success: false as const,
            error: "Voucher has passed its expiry deadline and is now EXPIRED.",
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
            now,
          });
          if (!qrCheck.valid) {
            return { success: false as const, error: qrCheck.reason };
          }
        }

        // Prevent duplicate active admission if student already has a direct CRM or BatchBuy enrollment
        const existingActiveAdmission = await findExistingActiveStudentAdmissionTx(tx, {
          instituteId: voucher.instituteId,
          batchId: voucher.batchId,
          phone: voucher.user.phone,
          email: voucher.user.email,
        });
        if (existingActiveAdmission) {
          return {
            success: false as const,
            duplicateExistingAdmissionId: existingActiveAdmission.id,
            error:
              existingActiveAdmission.batchBuyVoucherId === null
                ? "Student already has an active direct CRM admission for this institute/batch; BatchBuy redemption is blocked to prevent duplicate enrollment and commission."
                : "Student already has an active BatchBuy admission for this institute/batch.",
          };
        }

        const lockedTuitionNum = Number(voucher.netPayableTuition);
        if (input.upfrontDirectPaid > lockedTuitionNum) {
          return {
            success: false as const,
            error: `Direct tuition payment (₹${input.upfrontDirectPaid}) cannot exceed accepted offer tuition (₹${lockedTuitionNum}).`,
          };
        }
        if (input.excludedNonTuitionAmount >= lockedTuitionNum) {
          return {
            success: false as const,
            error: "Excluded non-tuition amount cannot equal or exceed total accepted tuition.",
          };
        }

        const existingConfirmedCount = await tx.admissionVoucher.count({
          where: {
            offerId: voucher.offerId,
            status: "REDEEMED",
            admissionRecord: { status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] } },
          },
        });
        const newConfirmedCount = existingConfirmedCount + 1;

        const qualifyingLowerPct =
          voucher.fallbackPolicy === "REVERT_TO_LOWER_SLAB" &&
          newConfirmedCount < voucher.minAdmissionQuorumSnapshot
            ? await resolveQualifyingLowerSlabPctTx(tx, {
                instituteId: voucher.instituteId,
                batchId: voucher.batchId,
                confirmedCount: newConfirmedCount,
                offerPublishedAt: voucher.offer.publishedAt,
              })
            : null;

        const settlementPlan = computeQuorumSettlementPlan({
          fallbackPolicy: voucher.fallbackPolicy as SlabFallbackPolicyType,
          minAdmissionQuorum: voucher.minAdmissionQuorumSnapshot,
          confirmedAdmissionsCount: newConfirmedCount,
          baseFee: Number(voucher.baseFee),
          lockedOfferTuition: lockedTuitionNum,
          qualifyingLowerSlabPct: qualifyingLowerPct,
        });

        if (settlementPlan.requiresDisclosureAtCounter && !input.shortfallDisclosureAccepted) {
          return {
            success: false as const,
            requiresDisclosure: true,
            error:
              "Counter check-in requires confirming fallback shortfall disclosure to the student before redeeming a provisional admission.",
          };
        }

        const studentPhone = voucher.user.phone || "0000000000";
        let enquiry = await tx.instituteEnquiry.findFirst({
          where: {
            instituteId: voucher.instituteId,
            source: "BATCHBUY",
            convertedToAdmission: false,
            OR: [
              ...(voucher.user.phone ? [{ phone: voucher.user.phone }] : []),
              ...(voucher.user.email ? [{ email: voucher.user.email }] : []),
            ],
          },
        });

        if (!enquiry) {
          enquiry = await tx.instituteEnquiry.create({
            data: {
              instituteId: voucher.instituteId,
              name: voucher.studentNameSnapshot,
              phone: studentPhone,
              email: voucher.user.email,
              course: voucher.batchNameSnapshot,
              batch: voucher.batchId,
              status: "APPROVED",
              assignedIsmId: authCtx.isIsmRole ? actorUserId : null,
              source: "BATCHBUY",
              sourceDetails: {
                cohortId: voucher.cohortId,
                cohortCode: voucher.cohort.cohortCode,
                offerId: voucher.offerId,
                offerVersion: voucher.offerVersion,
                voucherId: voucher.id,
                voucherCode: voucher.voucherCode,
              },
            },
          });
        }

        const remainingTuition = Math.max(
          0,
          Math.round((lockedTuitionNum - input.upfrontDirectPaid) * 100) / 100
        );
        const installments = [
          ...(input.upfrontDirectPaid > 0
            ? [
                {
                  amount: input.upfrontDirectPaid,
                  dueDate: now,
                  paidDate: now,
                  status: "PAID" as const,
                  note:
                    input.paymentModeNote?.trim() ||
                    `Paid directly to institute at BatchBuy check-in (${voucher.voucherCode}).`,
                },
              ]
            : []),
          ...(remainingTuition > 0
            ? [
                {
                  amount: remainingTuition,
                  dueDate: new Date(now.getTime() + 7 * 86_400_000),
                  status: "UPCOMING" as const,
                  note: "Direct tuition balance payable to institute (locked BatchBuy offer fee).",
                },
              ]
            : []),
        ];

        const admission = await createAdmissionFromPipelineTx(tx, {
          enquiryId: enquiry.id,
          instituteId: voucher.instituteId,
          ismId: enquiry.assignedIsmId || actorUserId,
          studentName: voucher.studentNameSnapshot,
          courseName: voucher.batchNameSnapshot,
          batchId: voucher.batchId,
          batchBuyVoucherId: voucher.id,
          batchBuyLockedFeeStr: voucher.netPayableTuition.toString(),
          batchBuySettledFeeStr:
            settlementPlan.redemptionSettlementState === "SETTLED_FULL_DISCOUNT"
              ? settlementPlan.lockedTuitionStr
              : null,
          totalFee: lockedTuitionNum,
          paidAmount: input.upfrontDirectPaid,
          admissionNote:
            input.admissionNote?.trim() ||
            `BatchBuy ${voucher.cohort.cohortCode} v${voucher.offerVersion} (${voucher.voucherCode}) — Accepted offer tuition ₹${lockedTuitionNum.toLocaleString("en-IN")}. Direct institute payment only.`,
          actorRole,
          actorName,
          activityContent: `BatchBuy voucher ${voucher.voucherCode} (${voucher.cohort.cohortCode}) redeemed at center for ₹${lockedTuitionNum.toLocaleString("en-IN")} tuition.`,
          activityMeta: {
            voucherId: voucher.id,
            voucherCode: voucher.voucherCode,
            settlementState: settlementPlan.redemptionSettlementState,
            fallbackPolicy: voucher.fallbackPolicy,
          },
          installments,
        });

        await tx.admissionVoucher.update({
          where: { id: voucher.id },
          data: {
            status: "REDEEMED",
            redeemedAt: now,
            redeemedById: actorUserId,
            redemptionMethod: parsedInput.mode === "QR_SCAN" ? "QR_SCAN" : input.redemptionMethod,
            settlementState: settlementPlan.redemptionSettlementState,
            disclosedFallbackFee: settlementPlan.disclosedFallbackFeeStr
              ? new Prisma.Decimal(settlementPlan.disclosedFallbackFeeStr)
              : null,
            settledTuition:
              settlementPlan.redemptionSettlementState === "SETTLED_FULL_DISCOUNT"
                ? new Prisma.Decimal(settlementPlan.lockedTuitionStr)
                : null,
            shortfallDisclosureAcceptedAt: settlementPlan.requiresDisclosureAtCounter
              ? now
              : null,
          },
        });

        await tx.groupCohortMember.update({
          where: { id: voucher.cohortMemberId },
          data: { stage: "ENROLLED_AT_CENTER" },
        });

        // Promote ONLY genuinely active provisional peers (never cancelled/refunded admissions!)
        if (settlementPlan.isAdmissionQuorumMet) {
          const provisionalPeers = await tx.admissionVoucher.findMany({
            where: {
              offerId: voucher.offerId,
              id: { not: voucher.id },
              status: "REDEEMED",
              settlementState: "PROVISIONAL_QUORUM_OPEN",
              admissionRecord: {
                status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] },
              },
            },
            select: {
              id: true,
              netPayableTuition: true,
              admissionRecord: { select: { id: true } },
            },
          });

          for (const peer of provisionalPeers) {
            await tx.admissionVoucher.update({
              where: { id: peer.id },
              data: {
                settlementState: "SETTLED_FULL_DISCOUNT",
                settledTuition: peer.netPayableTuition,
              },
            });
            if (peer.admissionRecord) {
              await tx.admissionRecord.update({
                where: { id: peer.admissionRecord.id },
                data: { batchBuySettledFee: peer.netPayableTuition },
              });
            }
          }
        }

        const commissionRateNum = voucher.offer.commissionRatePctSnapshot
          ? Number(voucher.offer.commissionRatePctSnapshot)
          : voucher.offer.commissionAgreement
          ? Number(voucher.offer.commissionAgreement.commissionRatePct)
          : null;

        if (commissionRateNum === null) {
          throw new Error(
            "Missing commercial commission snapshot on offer; cannot verify commission terms."
          );
        }

        const gstRateNum = voucher.offer.commissionAgreement
          ? Number(voucher.offer.commissionAgreement.gstRatePct)
          : 18;
        const holdingDays = Math.max(15, voucher.offer.holdingPeriodDaysSnapshot || 15);
        const windowDays = voucher.offer.attributionWindowDaysSnapshot || 30;
        const holdEndsAt = new Date(now.getTime() + holdingDays * 86_400_000);

        const commBreakdown = computeCommissionBreakdown({
          commissionableTuition: lockedTuitionNum,
          excludedNonTuitionAmount: input.excludedNonTuitionAmount,
          commissionRatePct: commissionRateNum,
          gstRatePct: gstRateNum,
          taxTreatmentMode: "PENDING_CA_VALIDATION",
        });

        const attribution = await tx.batchBuyAttribution.create({
          data: {
            instituteId: voucher.instituteId,
            cohortId: voucher.cohortId,
            offerId: voucher.offerId,
            cohortMemberId: voucher.cohortMemberId,
            userId: voucher.userId,
            voucherId: voucher.id,
            admissionId: admission.id,
            enquiryId: enquiry.id,
            sourceType: "VOUCHER_REDEMPTION",
            matchStatus: "VERIFIED",
            attributionWindowDaysUsed: windowDays,
            reviewedById: actorUserId,
            reviewedAt: now,
            evidenceJson: {
              voucherCode: voucher.voucherCode,
              redemptionMethod: parsedInput.mode,
              offerVersion: voucher.offerVersion,
              settlementState: settlementPlan.redemptionSettlementState,
            },
          },
        });

        const ledger = await tx.commissionLedgerEntry.create({
          data: {
            instituteId: voucher.instituteId,
            agreementId: voucher.offer.commissionAgreementId,
            admissionId: admission.id,
            voucherId: voucher.id,
            attributionId: attribution.id,
            commissionableTuition: new Prisma.Decimal(commBreakdown.commissionableTuitionStr),
            excludedNonTuitionAmount: new Prisma.Decimal(commBreakdown.excludedNonTuitionAmountStr),
            excludedChargesNote: input.excludedChargesNote?.trim() || null,
            commissionBaseRule: "SETTLED_TUITION_ONLY",
            commissionRatePct: new Prisma.Decimal(commBreakdown.commissionRatePctStr),
            commissionAmount: new Prisma.Decimal(commBreakdown.commissionAmountStr),
            gstRatePct: new Prisma.Decimal(commBreakdown.gstRatePctStr),
            gstAmount: new Prisma.Decimal(commBreakdown.gstAmountStr),
            totalPayableAmount: new Prisma.Decimal(commBreakdown.totalPayableAmountStr),
            status: "HOLD_PERIOD",
            redeemedAt: now,
            holdEndsAt,
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: voucher.instituteId,
          actorUserId,
          actorRole,
          action: "VOUCHER_REDEEMED",
          entityType: "AdmissionVoucher",
          entityId: voucher.id,
          afterState: {
            admissionId: admission.id,
            voucherCode: voucher.voucherCode,
            lockedTuition: voucher.netPayableTuition.toString(),
            settlementState: settlementPlan.redemptionSettlementState,
            commissionAmount: commBreakdown.commissionAmountStr,
            gstAmount: commBreakdown.gstAmountStr,
            holdEndsAt: holdEndsAt.toISOString(),
          },
        });

        return {
          success: true as const,
          instituteId: voucher.instituteId,
          admissionId: admission.id,
          voucherId: voucher.id,
          voucherCode: voucher.voucherCode,
          studentUserId: voucher.userId,
          cohortCode: voucher.cohort.cohortCode,
          settlementState: settlementPlan.redemptionSettlementState,
          confirmedAdmissionsCount: newConfirmedCount,
          minAdmissionQuorum: voucher.minAdmissionQuorumSnapshot,
          commissionId: ledger.id,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return result;
  } catch (err: unknown) {
    console.error("Failed to redeem BatchBuy voucher:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent counter check-in conflict. Please retry redeeming this voucher."
        : err instanceof Error
        ? err.message
        : "Failed to redeem BatchBuy voucher.",
    };
  }
}

/**
 * Transactional core for evaluating expired voucher windows against minAdmissionQuorum.
 */
export async function settleExpiredOfferAdmissionQuorumCore(
  offerId: string,
  authCtx: { userId: string; actorRole: string }
) {
  const actorUserId = authCtx.userId;
  const actorRole = authCtx.actorRole || "INSTITUTE_MANAGER";

  try {
    const settlement = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${offerId} FOR UPDATE`;

        const offer = await tx.cohortOffer.findUnique({
          where: { id: offerId },
          include: { cohort: { select: { cohortCode: true } } },
        });
        if (!offer) throw new Error("Offer not found.");

        const provisionals = await tx.admissionVoucher.findMany({
          where: {
            offerId,
            status: "REDEEMED",
            settlementState: "PROVISIONAL_QUORUM_OPEN",
            admissionRecord: {
              status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] },
            },
          },
          include: {
            admissionRecord: { select: { id: true, status: true } },
          },
        });

        if (provisionals.length === 0) {
          return {
            success: true as const,
            settledCount: 0,
            mode: "NONE_PENDING",
            notifications: [] as { userId: string; title: string; body: string }[],
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
          };
        }

        const confirmedCount = await tx.admissionVoucher.count({
          where: {
            offerId,
            status: "REDEEMED",
            admissionRecord: { status: { in: ["CONFIRMED", "PENDING_FALLBACK_CONSENT"] } },
          },
        });

        if (offer.voucherExpiresAt > now && confirmedCount < offer.minAdmissionQuorum) {
          return {
            success: false as const,
            error: `Voucher redemption window is still active until ${offer.voucherExpiresAt.toLocaleDateString("en-IN")} (${confirmedCount}/${offer.minAdmissionQuorum} enrolled).`,
          };
        }

        const lowerPct =
          offer.fallbackPolicy === "REVERT_TO_LOWER_SLAB" && confirmedCount < offer.minAdmissionQuorum
            ? await resolveQualifyingLowerSlabPctTx(tx, {
                instituteId: offer.instituteId,
                batchId: offer.batchId,
                confirmedCount,
                offerPublishedAt: offer.publishedAt,
              })
            : null;

        const plan = computeQuorumSettlementPlan({
          fallbackPolicy: offer.fallbackPolicy as SlabFallbackPolicyType,
          minAdmissionQuorum: offer.minAdmissionQuorum,
          confirmedAdmissionsCount: confirmedCount,
          baseFee: Number(offer.baseFee),
          lockedOfferTuition: Number(offer.netPayableTuition),
          qualifyingLowerSlabPct: lowerPct,
        });

        const notifications: { userId: string; title: string; body: string }[] = [];

        if (confirmedCount >= offer.minAdmissionQuorum || offer.fallbackPolicy === "ABSORB_SHORTFALL") {
          const targetState =
            confirmedCount >= offer.minAdmissionQuorum
              ? "SETTLED_FULL_DISCOUNT"
              : "SETTLED_SHORTFALL_ABSORBED";

          for (const v of provisionals) {
            await tx.admissionVoucher.update({
              where: { id: v.id },
              data: {
                settlementState: targetState,
                settledTuition: v.netPayableTuition,
              },
            });
            if (v.admissionRecord) {
              await tx.admissionRecord.update({
                where: { id: v.admissionRecord.id },
                data: {
                  status: "CONFIRMED",
                  batchBuySettledFee: v.netPayableTuition,
                },
              });
            }
          }

          await writeBatchBuyAuditLogTx(tx, {
            instituteId: offer.instituteId,
            actorUserId,
            actorRole,
            action: "OFFER_ADMISSION_QUORUM_SETTLED",
            entityType: "CohortOffer",
            entityId: offer.id,
            afterState: {
              confirmedCount,
              minAdmissionQuorum: offer.minAdmissionQuorum,
              targetState,
              settledVouchers: provisionals.length,
            },
          });

          return {
            success: true as const,
            settledCount: provisionals.length,
            mode: targetState,
            notifications,
            cohortCode: offer.cohort.cohortCode,
            instituteId: offer.instituteId,
          };
        }

        const disclosedDecimal = plan.disclosedFallbackFeeStr
          ? new Prisma.Decimal(plan.disclosedFallbackFeeStr)
          : offer.baseFee;

        for (const v of provisionals) {
          await tx.admissionVoucher.update({
            where: { id: v.id },
            data: {
              settlementState: "PENDING_STUDENT_FALLBACK_CONSENT",
              disclosedFallbackFee: disclosedDecimal,
              fallbackConsentRequestedAt: now,
            },
          });
          if (v.admissionRecord) {
            await tx.admissionRecord.update({
              where: { id: v.admissionRecord.id },
              data: { status: "PENDING_FALLBACK_CONSENT" },
            });
          }

          notifications.push({
            userId: v.userId,
            title: `Action Needed: Quorum Shortfall Settlement (${v.voucherCode})`,
            body: `Final center enrollments (${confirmedCount}/${offer.minAdmissionQuorum}) fell short. Under disclosed ${offer.fallbackPolicy} policy, review & accept revised fee ₹${Number(disclosedDecimal).toLocaleString("en-IN")} or cancel without penalty.`,
          });
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: offer.instituteId,
          actorUserId,
          actorRole,
          action: "FALLBACK_CONSENT_REQUESTED",
          entityType: "CohortOffer",
          entityId: offer.id,
          afterState: {
            confirmedCount,
            minAdmissionQuorum: offer.minAdmissionQuorum,
            fallbackPolicy: offer.fallbackPolicy,
            disclosedFallbackFee: disclosedDecimal.toString(),
            affectedVouchers: provisionals.length,
          },
        });

        return {
          success: true as const,
          settledCount: provisionals.length,
          mode: "PENDING_STUDENT_FALLBACK_CONSENT",
          notifications,
          cohortCode: offer.cohort.cohortCode,
          instituteId: offer.instituteId,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return settlement;
  } catch (err: unknown) {
    console.error("Failed offer admission quorum settlement:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent settlement update detected; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to evaluate offer admission quorum.",
    };
  }
}

export async function respondToFallbackAdjustmentCore(
  rawInput: {
    voucherId: string;
    acceptFallbackPrice: boolean;
    note?: string | null;
  },
  userId: string
) {
  const parsed = RespondFallbackAdjustmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid response.",
    };
  }

  const { voucherId, acceptFallbackPrice, note } = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "admission_voucher" WHERE id = ${voucherId} FOR UPDATE`;

        const voucher = await tx.admissionVoucher.findUnique({
          where: { id: voucherId },
          include: {
            cohort: { select: { cohortCode: true } },
            admissionRecord: true,
            commissionEntry: true,
          },
        });

        if (!voucher || voucher.userId !== userId) {
          return { success: false as const, error: "Voucher not found for your account." };
        }
        if (voucher.settlementState !== "PENDING_STUDENT_FALLBACK_CONSENT") {
          return {
            success: false as const,
            error: `Fallback adjustment decision is not pending (current state: ${voucher.settlementState}).`,
          };
        }
        if (!voucher.admissionRecord) {
          throw new Error("Linked admission record missing.");
        }

        const admission = voucher.admissionRecord;
        const revisedFeeDecimal = voucher.disclosedFallbackFee ?? voucher.netPayableTuition;
        const revisedFeeNum = Number(revisedFeeDecimal);
        const lockedFeeNum = Number(voucher.netPayableTuition);

        if (acceptFallbackPrice) {
          const delta = Math.max(0, Math.round((revisedFeeNum - lockedFeeNum) * 100) / 100);
          const newFeeStatus =
            admission.paidAmount <= 0
              ? "PENDING"
              : admission.paidAmount >= revisedFeeNum
              ? "PAID"
              : "PARTIAL";

          await tx.admissionVoucher.update({
            where: { id: voucher.id },
            data: {
              settlementState: "SETTLED_FALLBACK_ACCEPTED",
              settledTuition: revisedFeeDecimal,
              fallbackConsentRespondedAt: now,
              fallbackConsentAccepted: true,
            },
          });

          await tx.admissionRecord.update({
            where: { id: admission.id },
            data: {
              status: "CONFIRMED",
              batchBuySettledFee: revisedFeeDecimal,
              totalFee: revisedFeeNum,
              feeStatus: newFeeStatus,
              ...(delta > 0
                ? {
                    installments: {
                      create: {
                        amount: delta,
                        dueDate: new Date(now.getTime() + 7 * 86_400_000),
                        status: "UPCOMING",
                        note: `Student-approved fallback adjustment (${voucher.fallbackPolicy})`,
                      },
                    },
                  }
                : {}),
            },
          });

          if (
            voucher.commissionEntry &&
            ["HOLD_PERIOD", "ELIGIBLE"].includes(voucher.commissionEntry.status)
          ) {
            const recalc = computeCommissionBreakdown({
              commissionableTuition: revisedFeeNum,
              excludedNonTuitionAmount: Number(voucher.commissionEntry.excludedNonTuitionAmount),
              commissionRatePct: Number(voucher.commissionEntry.commissionRatePct),
              gstRatePct: Number(voucher.commissionEntry.gstRatePct),
            });
            await tx.commissionLedgerEntry.update({
              where: { id: voucher.commissionEntry.id },
              data: {
                commissionableTuition: new Prisma.Decimal(recalc.commissionableTuitionStr),
                commissionAmount: new Prisma.Decimal(recalc.commissionAmountStr),
                gstAmount: new Prisma.Decimal(recalc.gstAmountStr),
                totalPayableAmount: new Prisma.Decimal(recalc.totalPayableAmountStr),
              },
            });
          }

          await writeBatchBuyAuditLogTx(tx, {
            instituteId: voucher.instituteId,
            actorUserId: userId,
            actorRole: "STUDENT",
            action: "FALLBACK_CONSENT_ACCEPTED",
            entityType: "AdmissionVoucher",
            entityId: voucher.id,
            beforeState: { lockedTuition: lockedFeeNum, settlementState: voucher.settlementState },
            afterState: { settledTuition: revisedFeeNum, settlementState: "SETTLED_FALLBACK_ACCEPTED" },
            reason: note?.trim() || null,
          });

          return {
            success: true as const,
            accepted: true,
            cohortCode: voucher.cohort.cohortCode,
            instituteId: voucher.instituteId,
            settledTuition: revisedFeeNum,
          };
        }

        // Penalty-free exit when student declines fallback price increase
        const directPaidPaise = Math.max(0, Math.round(admission.paidAmount * 100));
        const directRefundStr = (directPaidPaise / 100).toFixed(2);

        await tx.admissionVoucher.update({
          where: { id: voucher.id },
          data: {
            settlementState: "CANCELLED_ON_SHORTFALL",
            settledTuition: null,
            fallbackConsentRespondedAt: now,
            fallbackConsentAccepted: false,
          },
        });

        await tx.admissionRecord.update({
          where: { id: admission.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancellationReason:
              note?.trim() ||
              "Student declined post-shortfall fallback fee adjustment (penalty-free exit).",
            directRefundRequiredAmount: new Prisma.Decimal(directRefundStr),
            directRefundStatus: directPaidPaise > 0 ? "PENDING_INSTITUTE_REFUND" : "NONE",
          },
        });

        await tx.groupCohortMember.update({
          where: { id: voucher.cohortMemberId },
          data: { stage: "DROPPED" },
        });

        let commissionTransition = "NO_COMMISSION_ENTRY";
        if (voucher.commissionEntry && voucher.commissionEntry.status !== "VOIDED_COOLING_OFF") {
          const rev = await reverseCommissionEntryTx(tx, {
            commissionEntryId: voucher.commissionEntry.id,
            admissionId: admission.id,
            instituteId: voucher.instituteId,
            reasonType: "FALLBACK_DECLINED",
            reasonText: "Student cancelled penalty-free following minAdmissionQuorum shortfall.",
            actorUserId: userId,
            actorRole: "STUDENT",
            now,
          });
          commissionTransition = rev.outcome;
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: voucher.instituteId,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "FALLBACK_CONSENT_DECLINED",
          entityType: "AdmissionVoucher",
          entityId: voucher.id,
          afterState: {
            settlementState: "CANCELLED_ON_SHORTFALL",
            admissionStatus: "CANCELLED",
            commissionTransition,
            directRefundRequiredAmount: directRefundStr,
          },
          reason: note?.trim() || null,
        });

        return {
          success: true as const,
          accepted: false,
          cohortCode: voucher.cohort.cohortCode,
          instituteId: voucher.instituteId,
          directRefundRequiredAmount: Number(directRefundStr),
          commissionTransition,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return result;
  } catch (err: unknown) {
    console.error("Failed fallback adjustment response:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent fallback decision conflict; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to submit fallback response.",
    };
  }
}

/**
 * Transactional core for cancelling/refunding a BatchBuy admission.
 * Atomically transitions the voucher out of PROVISIONAL_QUORUM_OPEN -> CANCELLED_AFTER_REDEMPTION
 * so future quorum redemptions cannot resurrect a cancelled admission, and routes any
 * INVOICED / SETTLED commissions through the immutable Credit Note workflow.
 */
export async function cancelOrRefundBatchBuyAdmissionCore(
  rawInput: {
    admissionId: string;
    reason: string;
    directRefundRequiredAmount?: number | null;
    directRefundCompleted?: boolean;
  },
  authCtx: { userId: string; actorRole: string }
) {
  const parsed = CancelBatchBuyAdmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid cancellation input.",
    };
  }

  const actorUserId = authCtx.userId;
  const actorRole = authCtx.actorRole || "INSTITUTE_MANAGER";

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "admission_record" WHERE id = ${parsed.data.admissionId} FOR UPDATE`;

        const admission = await tx.admissionRecord.findUnique({
          where: { id: parsed.data.admissionId },
          include: {
            batchBuyVoucher: {
              include: { cohort: { select: { cohortCode: true } } },
            },
            commissionEntry: true,
          },
        });
        if (!admission) throw new Error("Admission not found.");
        if (!admission.batchBuyVoucherId) {
          throw new Error("BatchBuy admission record not found.");
        }
        if (["CANCELLED", "REFUNDED"].includes(admission.status)) {
          return {
            success: false as const,
            error: `Admission is already ${admission.status}.`,
          };
        }

        if (admission.batchBuyVoucher) {
          await tx.$queryRaw`SELECT id FROM "admission_voucher" WHERE id = ${admission.batchBuyVoucher.id} FOR UPDATE`;
        }

        const refundAmountNum =
          parsed.data.directRefundRequiredAmount ?? admission.paidAmount ?? 0;
        const refundAmountStr = Math.max(0, Number(refundAmountNum)).toFixed(2);
        const newStatus = parsed.data.directRefundCompleted ? "REFUNDED" : "CANCELLED";

        await tx.admissionRecord.update({
          where: { id: admission.id },
          data: {
            status: newStatus,
            cancelledAt: now,
            cancellationReason: parsed.data.reason.trim(),
            directRefundRequiredAmount: new Prisma.Decimal(refundAmountStr),
            directRefundStatus:
              Number(refundAmountStr) <= 0
                ? "NONE"
                : parsed.data.directRefundCompleted
                ? "REFUNDED"
                : "PENDING_INSTITUTE_REFUND",
          },
        });

        // Atomically transition linked voucher so provisional cancellations can never be resurrected by peer quorum events
        if (admission.batchBuyVoucher) {
          const v = admission.batchBuyVoucher;
          const nextVoucherState =
            v.settlementState === "CANCELLED_ON_SHORTFALL"
              ? "CANCELLED_ON_SHORTFALL"
              : "CANCELLED_AFTER_REDEMPTION";
          await tx.admissionVoucher.update({
            where: { id: v.id },
            data: {
              settlementState: nextVoucherState,
              settledTuition: null,
            },
          });
          await tx.groupCohortMember.update({
            where: { id: v.cohortMemberId },
            data: { stage: "DROPPED" },
          });
        }

        let commissionTransition: string = "NO_COMMISSION_ENTRY";
        let creditNoteNumber: string | null = null;
        if (admission.commissionEntry) {
          const entry = admission.commissionEntry;
          const withinHold = now <= entry.holdEndsAt && entry.status === "HOLD_PERIOD";
          const reasonType: CommissionCreditNoteReason = withinHold
            ? "COOLING_OFF_CANCELLATION"
            : "POST_HOLD_CLAWBACK";

          const rev = await reverseCommissionEntryTx(tx, {
            commissionEntryId: entry.id,
            admissionId: admission.id,
            instituteId: admission.instituteId,
            reasonType,
            reasonText: `Admission ${newStatus} (${withinHold ? "within" : "post"} 15-day commercial hold): ${parsed.data.reason.trim()}`,
            actorUserId,
            actorRole,
            now,
          });
          commissionTransition = rev.outcome;
          creditNoteNumber = rev.creditNoteNumber ?? null;
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: admission.instituteId,
          actorUserId,
          actorRole,
          action: "ADMISSION_CANCELLED",
          entityType: "AdmissionRecord",
          entityId: admission.id,
          beforeState: { status: admission.status },
          afterState: {
            status: newStatus,
            voucherSettlementState: admission.batchBuyVoucher ? "CANCELLED_AFTER_REDEMPTION" : null,
            commissionTransition,
            creditNoteNumber,
            directRefundRequiredAmount: refundAmountStr,
          },
          reason: parsed.data.reason.trim(),
        });

        return {
          success: true as const,
          admissionId: admission.id,
          commissionStatus: commissionTransition,
          creditNoteNumber,
          instituteId: admission.instituteId,
          cohortCode: admission.batchBuyVoucher?.cohort.cohortCode ?? null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return outcome;
  } catch (err: unknown) {
    console.error("Failed to cancel BatchBuy admission:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent cancellation conflict; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to cancel BatchBuy admission.",
    };
  }
}
