import { Prisma } from "@/app/generated/prisma/client";
import { normalizeIndianPhone } from "@/lib/batchbuy/cohortValidation";
import { writeBatchBuyAuditLogTx } from "@/lib/batchbuy/redemptionAuth";

export interface AdmissionInstallmentSpec {
  amount: number;
  dueDate: string | Date;
  paidDate?: string | Date | null;
  status?: "UPCOMING" | "PAID" | "OVERDUE";
  note?: string | null;
}

export interface CreateAdmissionPipelineParams {
  enquiryId: string;
  instituteId: string;
  ismId: string;
  studentName: string;
  courseName?: string | null;
  batchId?: string | null;
  batchBuyVoucherId?: string | null;
  batchBuyLockedFeeStr?: string | null;
  batchBuySettledFeeStr?: string | null;
  totalFee: number;
  paidAmount: number;
  feeStatus?: "PENDING" | "PARTIAL" | "PAID";
  admissionStatus?: "CONFIRMED" | "PENDING_FALLBACK_CONSENT";
  enquiryStatus?: string;
  admissionNote?: string | null;
  actorRole: string;
  actorName: string;
  activityContent: string;
  activityMeta?: Prisma.InputJsonValue;
  installments: AdmissionInstallmentSpec[];
}

/**
 * Shared transactional core for creating official AdmissionRecord entries.
 * Used identically by both the standard ISM CRM pipeline (`convertToAdmission`)
 * and BatchBuy counter voucher redemption (`redeemBatchBuyVoucherAction`), ensuring
 * AdmissionRecord remains the single official admission source of truth.
 */
export async function createAdmissionFromPipelineTx(
  tx: Prisma.TransactionClient,
  params: CreateAdmissionPipelineParams
) {
  const existingForEnquiry = await tx.admissionRecord.findUnique({
    where: { enquiryId: params.enquiryId },
    select: { id: true },
  });
  if (existingForEnquiry) {
    throw new Error("This enquiry has already been converted to an admission record.");
  }

  if (params.batchBuyVoucherId) {
    const existingForVoucher = await tx.admissionRecord.findUnique({
      where: { batchBuyVoucherId: params.batchBuyVoucherId },
      select: { id: true },
    });
    if (existingForVoucher) {
      throw new Error("This BatchBuy voucher has already been redeemed for an admission record.");
    }
  }

  const computedFeeStatus =
    params.feeStatus ??
    (params.paidAmount <= 0
      ? "PENDING"
      : params.paidAmount >= params.totalFee
      ? "PAID"
      : "PARTIAL");

  const admission = await tx.admissionRecord.create({
    data: {
      enquiryId: params.enquiryId,
      instituteId: params.instituteId,
      ismId: params.ismId,
      batchId: params.batchId ?? null,
      batchBuyVoucherId: params.batchBuyVoucherId ?? null,
      studentName: params.studentName,
      courseName: params.courseName ?? null,
      totalFee: params.totalFee,
      paidAmount: params.paidAmount,
      batchBuyLockedFee: params.batchBuyLockedFeeStr
        ? new Prisma.Decimal(params.batchBuyLockedFeeStr)
        : null,
      batchBuySettledFee: params.batchBuySettledFeeStr
        ? new Prisma.Decimal(params.batchBuySettledFeeStr)
        : null,
      feeStatus: computedFeeStatus,
      status: params.admissionStatus ?? "CONFIRMED",
      admissionNote: params.admissionNote ?? null,
      installments: {
        create: (params.installments ?? []).map((inst) => ({
          amount: inst.amount,
          dueDate: new Date(inst.dueDate),
          paidDate: inst.paidDate ? new Date(inst.paidDate) : null,
          status: inst.status ?? "UPCOMING",
          note: inst.note ?? null,
        })),
      },
    },
  });

  await tx.instituteEnquiry.update({
    where: { id: params.enquiryId },
    data: {
      convertedToAdmission: true,
      status: params.enquiryStatus ?? "APPROVED",
      lastUpdatedByRole: params.actorRole,
      lastUpdatedByName: params.actorName,
    },
  });

  await tx.ismLeadActivity.create({
    data: {
      enquiryId: params.enquiryId,
      ismId: params.ismId,
      type: "CONVERTED",
      content: params.activityContent,
      meta: params.activityMeta ?? Prisma.JsonNull,
    },
  });

  return admission;
}

/**
 * Non-blocking anti-bypass detector executed during normal CRM `convertToAdmission`.
 * Never blocks admission and NEVER automatically creates commission liabilities from
 * a phone match alone; instead creates a FLAGGED_SUSPECTED_BYPASS attribution + audit log
 * for platform admin adjudication.
 */
export async function detectAndFlagPotentialBypassTx(
  tx: Prisma.TransactionClient,
  params: {
    admissionId: string;
    enquiryId: string;
    instituteId: string;
    leadName: string;
    leadPhone: string;
    leadEmail?: string | null;
    actorUserId: string;
    actorRole: string;
    now: Date;
  }
): Promise<{ flagged: boolean; attributionId?: string }> {
  // Check active agreement window length (defaults to 30 days attribution lookback rule)
  const agreement = await tx.instituteBatchBuyAgreement.findFirst({
    where: { instituteId: params.instituteId, status: "ACTIVE" },
    orderBy: [{ version: "desc" }],
    select: { attributionWindowDays: true },
  });
  const windowDays = agreement?.attributionWindowDays ?? 30;
  const lookbackStart = new Date(params.now.getTime() - windowDays * 86_400_000);

  const normalizedLeadPhone = normalizeIndianPhone(params.leadPhone);
  const normalizedLeadEmail = params.leadEmail?.trim().toLowerCase() || null;
  if (!normalizedLeadPhone && !normalizedLeadEmail) {
    return { flagged: false };
  }

  const candidateMembers = await tx.groupCohortMember.findMany({
    where: {
      joinedAt: { gte: lookbackStart },
      stage: { not: "DROPPED" },
      cohort: { instituteId: params.instituteId },
      user: {
        OR: [
          ...(normalizedLeadPhone ? [{ phone: { contains: normalizedLeadPhone } }] : []),
          ...(normalizedLeadEmail ? [{ email: normalizedLeadEmail }] : []),
        ],
      },
    },
    orderBy: { joinedAt: "desc" },
    take: 3,
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      cohort: { select: { id: true, cohortCode: true, batchId: true } },
      vouchers: {
        where: { status: { in: ["PENDING_QUORUM", "ACTIVE"] } },
        orderBy: { issuedAt: "desc" },
        take: 1,
        select: { id: true, voucherCode: true, offerId: true, status: true, issuedAt: true },
      },
    },
  });

  // Evaluate exact normalized phone or exact email match
  const matchedMember = candidateMembers.find((m) => {
    const memberPhone = normalizeIndianPhone(m.user.phone);
    const memberEmail = m.user.email?.trim().toLowerCase() || null;
    const phoneMatch = Boolean(normalizedLeadPhone && memberPhone === normalizedLeadPhone);
    const emailMatch = Boolean(normalizedLeadEmail && memberEmail === normalizedLeadEmail);
    return phoneMatch || emailMatch;
  });

  if (!matchedMember) {
    return { flagged: false };
  }

  const candidateVoucher = matchedMember.vouchers[0] ?? null;

  // Ensure the matched voucher isn't already linked to an existing attribution/admission
  if (candidateVoucher) {
    const alreadyAttributed = await tx.batchBuyAttribution.findUnique({
      where: { voucherId: candidateVoucher.id },
      select: { id: true },
    });
    if (alreadyAttributed) {
      return { flagged: false };
    }
  }

  const memberPhone = normalizeIndianPhone(matchedMember.user.phone);
  const phoneMatched = Boolean(normalizedLeadPhone && memberPhone === normalizedLeadPhone);
  const emailMatched = Boolean(
    normalizedLeadEmail &&
      matchedMember.user.email?.trim().toLowerCase() === normalizedLeadEmail
  );
  const nameMatched =
    matchedMember.user.name?.trim().toLowerCase() === params.leadName.trim().toLowerCase();

  const evidencePayload = {
    rule: "NON_BLOCKING_CRM_LOOKBACK",
    windowDays,
    signals: {
      phoneMatched,
      emailMatched,
      nameMatched,
      hasUnredeemedVoucher: Boolean(candidateVoucher),
    },
    cohortId: matchedMember.cohort.id,
    cohortCode: matchedMember.cohort.cohortCode,
    cohortMemberId: matchedMember.id,
    joinedAt: matchedMember.joinedAt.toISOString(),
    matchedUserId: matchedMember.user.id,
    candidateVoucherId: candidateVoucher?.id ?? null,
    candidateVoucherCode: candidateVoucher?.voucherCode ?? null,
    note: "Flagged for admin verification. Phone match alone does NOT create commission liability.",
  };

  // Do NOT link voucherId FK here because a flagged false positive shouldn't lock an active voucher
  const attribution = await tx.batchBuyAttribution.create({
    data: {
      instituteId: params.instituteId,
      cohortId: matchedMember.cohort.id,
      offerId: candidateVoucher?.offerId ?? null,
      cohortMemberId: matchedMember.id,
      userId: matchedMember.user.id,
      voucherId: null,
      admissionId: params.admissionId,
      enquiryId: params.enquiryId,
      sourceType: "COHORT_LEAD_MATCH",
      matchStatus: "FLAGGED_SUSPECTED_BYPASS",
      attributionWindowDaysUsed: windowDays,
      evidenceJson: evidencePayload,
    },
  });

  await writeBatchBuyAuditLogTx(tx, {
    instituteId: params.instituteId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: "BYPASS_FLAGGED",
    entityType: "BatchBuyAttribution",
    entityId: attribution.id,
    afterState: evidencePayload,
    reason:
      "CRM admission matched recent BatchBuy cohort applicant within attribution window; queued for admin review without blocking admission.",
  });

  return { flagged: true, attributionId: attribution.id };
}
