import { prisma } from "@/lib/prisma";
import { verifyCounterRedemptionAccess, verifyPlatformAdminAccess } from "./redemptionAuth";
import { getInstituteAgreementsSummary } from "./agreementActions";

export interface InstituteVoucherLifecycleDTO {
  id: string;
  voucherCode: string;
  offerId: string;
  offerVersion: number;
  cohortId: string;
  cohortCode: string;
  cohortTitle: string;
  studentName: string;
  batchName: string;
  status: string;
  settlementState: string | null;
  fallbackPolicy: string;
  baseFee: number;
  discountPercentage: number;
  discountAmount: number;
  netPayableTuition: number;
  disclosedFallbackFee: number | null;
  settledTuition: number | null;
  minAcceptanceQuorum: number;
  minAdmissionQuorum: number;
  expiresAt: string;
  redeemedAt: string | null;
  redemptionMethod: string | null;
  fallbackConsentRequestedAt: string | null;
  fallbackConsentRespondedAt: string | null;
  fallbackConsentAccepted: boolean | null;
  admission: {
    id: string;
    totalFee: number;
    paidAmount: number;
    feeStatus: string;
    status: string;
    batchBuyLockedFee: number | null;
    batchBuySettledFee: number | null;
    directRefundRequiredAmount: number | null;
    directRefundStatus: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  } | null;
  commissionEntry: {
    id: string;
    status: string;
    commissionableTuition: number;
    excludedNonTuitionAmount: number;
    commissionRatePct: number;
    commissionAmount: number;
    gstRatePct: number;
    gstAmount: number;
    totalPayableAmount: number;
    holdEndsAt: string;
    voidReason: string | null;
  } | null;
}

export interface OfferQuorumSettlementItemDTO {
  id: string;
  cohortId: string;
  cohortCode: string;
  cohortTitle: string;
  batchName: string;
  version: number;
  title: string;
  fallbackPolicy: string;
  minAcceptanceQuorum: number;
  minAdmissionQuorum: number;
  voucherExpiresAt: string;
  isVoucherWindowElapsed: boolean;
  redeemedCount: number;
  provisionalOpenCount: number;
  pendingConsentCount: number;
}

export interface BatchBuyCreditNoteDTO {
  id: string;
  creditNoteNumber: string;
  instituteId: string | null;
  instituteIdSnapshot: string;
  instituteName: string | null;
  invoiceId: string;
  invoiceNumber: string;
  commissionEntryId: string;
  admissionId: string;
  reasonType: string;
  status: string;
  originalLedgerStatus: string;
  originalInvoiceStatus: string;
  commissionReversalAmount: number;
  cgstReversalAmount: number;
  sgstReversalAmount: number;
  igstReversalAmount: number;
  gstReversalTotal: number;
  totalCreditAmount: number;
  appliedToInvoiceBalance: number;
  refundPayableToInstitute: number;
  taxTreatmentModeUsed: string;
  sacCodeUsed: string | null;
  reason: string;
  settledRefundUtr: string | null;
  settledRefundAt: string | null;
  createdAt: string;
}

export interface CommissionInvoiceDTO {
  id: string;
  invoiceNumber: string;
  instituteId: string;
  instituteName: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueAt: string | null;
  dueDaysUsed: number;
  subtotalCommission: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  gstTotalAmount: number;
  totalPayableAmount: number;
  appliedCreditAmount: number;
  effectiveCollectibleBalance: number;
  amountPaid: number;
  status: string;
  taxTreatmentMode: string;
  sacCodeUsed: string | null;
  sacValidationDisclaimer: string | null;
  instituteGstinSnapshot: string | null;
  academyFindGstin: string | null;
  notes: string | null;
  entryCount: number;
  payments: {
    id: string;
    amount: number;
    paymentMode: string;
    utrOrReference: string;
    paidAt: string;
    note: string | null;
  }[];
}

export interface FlaggedAttributionDTO {
  id: string;
  instituteId: string;
  instituteName: string;
  admissionId: string;
  enquiryId: string;
  studentName: string;
  courseName: string | null;
  admissionTotalFee: number;
  admissionCreatedAt: string;
  sourceType: string;
  matchStatus: string;
  attributionWindowDaysUsed: number;
  evidenceJson: Record<string, unknown> | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface BatchBuyAuditEntryDTO {
  id: string;
  instituteId: string | null;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
}

export async function getInstituteRedemptionWorkspace(instituteId: string) {
  const authCheck = await verifyCounterRedemptionAccess(instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return {
      success: false as const,
      error: authCheck.error || "Unauthorized",
    };
  }

  const now = new Date();
  const [
    institute,
    agreementsSummary,
    vouchers,
    offersWithRedeemed,
    attributions,
    invoices,
    creditNotes,
    auditLogs,
  ] = await Promise.all([
    prisma.institute.findUnique({
      where: { id: instituteId },
      select: { id: true, name: true, city: { select: { name: true } } },
    }),
    getInstituteAgreementsSummary(instituteId),
    prisma.admissionVoucher.findMany({
      where: { instituteId },
      orderBy: [{ redeemedAt: "desc" }, { issuedAt: "desc" }],
      take: 80,
      include: {
        cohort: { select: { cohortCode: true, title: true } },
        admissionRecord: {
          select: {
            id: true,
            totalFee: true,
            paidAmount: true,
            feeStatus: true,
            status: true,
            batchBuyLockedFee: true,
            batchBuySettledFee: true,
            directRefundRequiredAmount: true,
            directRefundStatus: true,
            cancelledAt: true,
            cancellationReason: true,
          },
        },
        commissionEntry: {
          select: {
            id: true,
            status: true,
            commissionableTuition: true,
            excludedNonTuitionAmount: true,
            commissionRatePct: true,
            commissionAmount: true,
            gstRatePct: true,
            gstAmount: true,
            totalPayableAmount: true,
            holdEndsAt: true,
            voidReason: true,
          },
        },
      },
    }),
    prisma.cohortOffer.findMany({
      where: {
        cohort: { instituteId },
        status: { in: ["QUORUM_MET", "PUBLISHED", "SUPERSEDED", "EXPIRED"] },
        vouchers: { some: { status: "REDEEMED" } },
      },
      orderBy: [{ voucherExpiresAt: "desc" }],
      take: 30,
      include: {
        cohort: {
          select: {
            cohortCode: true,
            title: true,
            batch: { select: { name: true } },
          },
        },
        vouchers: {
          where: { status: "REDEEMED" },
          select: { id: true, settlementState: true },
        },
      },
    }),
    prisma.batchBuyAttribution.findMany({
      where: { instituteId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        admission: {
          select: {
            studentName: true,
            courseName: true,
            totalFee: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.batchBuyCommissionInvoice.findMany({
      where: { instituteId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        payments: { orderBy: { paidAt: "desc" } },
        creditNotes: {
          select: { appliedToInvoiceBalance: true, status: true },
        },
        _count: { select: { entries: true } },
      },
    }),
    prisma.batchBuyCreditNote.findMany({
      where: { OR: [{ instituteId }, { instituteIdSnapshot: instituteId }] },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    prisma.batchBuyAuditLog.findMany({
      where: { instituteId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        actor: { select: { name: true } },
      },
    }),
  ]);

  if (!institute) {
    return { success: false as const, error: "Institute not found." };
  }

  const mappedVouchers: InstituteVoucherLifecycleDTO[] = vouchers.map((v) => ({
    id: v.id,
    voucherCode: v.voucherCode,
    offerId: v.offerId,
    offerVersion: v.offerVersion,
    cohortId: v.cohortId,
    cohortCode: v.cohort.cohortCode,
    cohortTitle: v.cohort.title,
    studentName: v.studentNameSnapshot,
    batchName: v.batchNameSnapshot,
    status: v.status,
    settlementState: v.settlementState,
    fallbackPolicy: v.fallbackPolicy,
    baseFee: Number(v.baseFee),
    discountPercentage: Number(v.discountPercentage),
    discountAmount: Number(v.discountAmount),
    netPayableTuition: Number(v.netPayableTuition),
    disclosedFallbackFee:
      v.disclosedFallbackFee != null ? Number(v.disclosedFallbackFee) : null,
    settledTuition: v.settledTuition != null ? Number(v.settledTuition) : null,
    minAcceptanceQuorum: v.minAcceptanceQuorumSnapshot,
    minAdmissionQuorum: v.minAdmissionQuorumSnapshot,
    expiresAt: v.expiresAt.toISOString(),
    redeemedAt: v.redeemedAt ? v.redeemedAt.toISOString() : null,
    redemptionMethod: v.redemptionMethod,
    fallbackConsentRequestedAt: v.fallbackConsentRequestedAt
      ? v.fallbackConsentRequestedAt.toISOString()
      : null,
    fallbackConsentRespondedAt: v.fallbackConsentRespondedAt
      ? v.fallbackConsentRespondedAt.toISOString()
      : null,
    fallbackConsentAccepted: v.fallbackConsentAccepted,
    admission: v.admissionRecord
      ? {
          id: v.admissionRecord.id,
          totalFee: v.admissionRecord.totalFee,
          paidAmount: v.admissionRecord.paidAmount,
          feeStatus: v.admissionRecord.feeStatus,
          status: v.admissionRecord.status,
          batchBuyLockedFee:
            v.admissionRecord.batchBuyLockedFee != null
              ? Number(v.admissionRecord.batchBuyLockedFee)
              : null,
          batchBuySettledFee:
            v.admissionRecord.batchBuySettledFee != null
              ? Number(v.admissionRecord.batchBuySettledFee)
              : null,
          directRefundRequiredAmount:
            v.admissionRecord.directRefundRequiredAmount != null
              ? Number(v.admissionRecord.directRefundRequiredAmount)
              : null,
          directRefundStatus: v.admissionRecord.directRefundStatus,
          cancelledAt: v.admissionRecord.cancelledAt
            ? v.admissionRecord.cancelledAt.toISOString()
            : null,
          cancellationReason: v.admissionRecord.cancellationReason,
        }
      : null,
    commissionEntry: v.commissionEntry
      ? {
          id: v.commissionEntry.id,
          status: v.commissionEntry.status,
          commissionableTuition: Number(v.commissionEntry.commissionableTuition),
          excludedNonTuitionAmount: Number(
            v.commissionEntry.excludedNonTuitionAmount
          ),
          commissionRatePct: Number(v.commissionEntry.commissionRatePct),
          commissionAmount: Number(v.commissionEntry.commissionAmount),
          gstRatePct: Number(v.commissionEntry.gstRatePct),
          gstAmount: Number(v.commissionEntry.gstAmount),
          totalPayableAmount: Number(v.commissionEntry.totalPayableAmount),
          holdEndsAt: v.commissionEntry.holdEndsAt.toISOString(),
          voidReason: v.commissionEntry.voidReason,
        }
      : null,
  }));

  const offersForQuorumSettlement: OfferQuorumSettlementItemDTO[] =
    offersWithRedeemed.map((o) => ({
      id: o.id,
      cohortId: o.cohortId,
      cohortCode: o.cohort.cohortCode,
      cohortTitle: o.cohort.title,
      batchName: o.cohort.batch.name,
      version: o.version,
      title: o.title,
      fallbackPolicy: o.fallbackPolicy,
      minAcceptanceQuorum: o.minAcceptanceQuorum,
      minAdmissionQuorum: o.minAdmissionQuorum,
      voucherExpiresAt: o.voucherExpiresAt.toISOString(),
      isVoucherWindowElapsed: o.voucherExpiresAt <= now,
      redeemedCount: o.vouchers.length,
      provisionalOpenCount: o.vouchers.filter(
        (v) => v.settlementState === "PROVISIONAL_QUORUM_OPEN"
      ).length,
      pendingConsentCount: o.vouchers.filter(
        (v) => v.settlementState === "PENDING_STUDENT_FALLBACK_CONSENT"
      ).length,
    }));

  const mappedAttributions: FlaggedAttributionDTO[] = attributions.map((a) => ({
    id: a.id,
    instituteId: a.instituteId,
    instituteName: institute.name,
    admissionId: a.admissionId,
    enquiryId: a.enquiryId,
    studentName: a.admission.studentName,
    courseName: a.admission.courseName,
    admissionTotalFee: a.admission.totalFee,
    admissionCreatedAt: a.admission.createdAt.toISOString(),
    sourceType: a.sourceType,
    matchStatus: a.matchStatus,
    attributionWindowDaysUsed: a.attributionWindowDaysUsed,
    evidenceJson:
      a.evidenceJson && typeof a.evidenceJson === "object"
        ? (a.evidenceJson as Record<string, unknown>)
        : null,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    reviewNote: a.reviewNote,
    createdAt: a.createdAt.toISOString(),
  }));

  const mappedInvoices: CommissionInvoiceDTO[] = invoices.map((inv) => {
    const appliedCredit = inv.creditNotes.reduce(
      (sum, cn) => sum + Number(cn.appliedToInvoiceBalance),
      0
    );
    const effectiveBalance = Math.max(
      0,
      Math.round((Number(inv.totalPayableAmount) - appliedCredit - Number(inv.amountPaid)) * 100) /
        100
    );
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      instituteId: inv.instituteId,
      instituteName: institute.name,
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      dueDaysUsed: inv.dueDaysUsed,
      subtotalCommission: Number(inv.subtotalCommission),
      cgstAmount: Number(inv.cgstAmount),
      sgstAmount: Number(inv.sgstAmount),
      igstAmount: Number(inv.igstAmount),
      gstTotalAmount: Number(inv.gstTotalAmount),
      totalPayableAmount: Number(inv.totalPayableAmount),
      appliedCreditAmount: Math.round(appliedCredit * 100) / 100,
      effectiveCollectibleBalance: effectiveBalance,
      amountPaid: Number(inv.amountPaid),
      status: inv.status,
      taxTreatmentMode: inv.taxTreatmentMode,
      sacCodeUsed: inv.sacCodeUsed,
      sacValidationDisclaimer: inv.sacValidationDisclaimer,
      instituteGstinSnapshot: inv.instituteGstinSnapshot,
      academyFindGstin: inv.academyFindGstin,
      notes: inv.notes,
      entryCount: inv._count.entries,
      payments: inv.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentMode: p.paymentMode,
        utrOrReference: p.utrOrReference,
        paidAt: p.paidAt.toISOString(),
        note: p.note,
      })),
    };
  });

  const mappedCreditNotes: BatchBuyCreditNoteDTO[] = creditNotes.map((cn) => ({
    id: cn.id,
    creditNoteNumber: cn.creditNoteNumber,
    instituteId: cn.instituteId,
    instituteIdSnapshot: cn.instituteIdSnapshot,
    instituteName: institute.name,
    invoiceId: cn.invoiceId,
    invoiceNumber: cn.invoice.invoiceNumber,
    commissionEntryId: cn.commissionEntryId,
    admissionId: cn.admissionId,
    reasonType: cn.reasonType,
    status: cn.status,
    originalLedgerStatus: cn.originalLedgerStatus,
    originalInvoiceStatus: cn.originalInvoiceStatus,
    commissionReversalAmount: Number(cn.commissionReversalAmount),
    cgstReversalAmount: Number(cn.cgstReversalAmount),
    sgstReversalAmount: Number(cn.sgstReversalAmount),
    igstReversalAmount: Number(cn.igstReversalAmount),
    gstReversalTotal: Number(cn.gstReversalTotal),
    totalCreditAmount: Number(cn.totalCreditAmount),
    appliedToInvoiceBalance: Number(cn.appliedToInvoiceBalance),
    refundPayableToInstitute: Number(cn.refundPayableToInstitute),
    taxTreatmentModeUsed: cn.taxTreatmentModeUsed,
    sacCodeUsed: cn.sacCodeUsed,
    reason: cn.reason,
    settledRefundUtr: cn.settledRefundUtr,
    settledRefundAt: cn.settledRefundAt ? cn.settledRefundAt.toISOString() : null,
    createdAt: cn.createdAt.toISOString(),
  }));

  const mappedLogs: BatchBuyAuditEntryDTO[] = auditLogs.map((log) => ({
    id: log.id,
    instituteId: log.instituteId ?? log.instituteIdSnapshot,
    actorUserId: log.actorUserId,
    actorName: log.actor.name || log.actorRole,
    actorRole: log.actorRole,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    reason: log.reason,
    afterState:
      log.afterState && typeof log.afterState === "object"
        ? (log.afterState as Record<string, unknown>)
        : null,
    createdAt: log.createdAt.toISOString(),
  }));

  return {
    success: true as const,
    actor: {
      userId: authCheck.userId,
      role: authCheck.actorRole || "INSTITUTE_MANAGER",
      isIsmRole: Boolean(authCheck.isIsmRole),
    },
    institute: {
      id: institute.id,
      name: institute.name,
      cityName: institute.city?.name ?? null,
    },
    agreementsSummary,
    vouchers: mappedVouchers,
    offersForQuorumSettlement,
    attributions: mappedAttributions,
    invoices: mappedInvoices,
    creditNotes: mappedCreditNotes,
    auditLogs: mappedLogs,
  };
}

export async function getAdminBatchBuyReconciliationWorkspace() {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return {
      success: false as const,
      error: adminCheck.error || "Platform Admin access required.",
    };
  }

  const now = new Date();
  const [
    institutes,
    agreements,
    flaggedAttributions,
    ledgerEntries,
    invoices,
    creditNotes,
    auditLogs,
  ] = await Promise.all([
    prisma.institute.findMany({
      where: {
        OR: [
          { admissionCohorts: { some: {} } },
          { batchBuyAgreements: { some: {} } },
          { commissionLedgerEntries: { some: {} } },
          { batchBuyAttributions: { some: {} } },
        ],
      },
      select: {
        id: true,
        name: true,
        city: { select: { name: true } },
        subscriptionPlan: true,
      },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.instituteBatchBuyAgreement.findMany({
      orderBy: [{ instituteId: "asc" }, { version: "desc" }],
      take: 150,
      include: {
        institute: { select: { name: true, city: { select: { name: true } } } },
      },
    }),
    prisma.batchBuyAttribution.findMany({
      where: {
        matchStatus: {
          in: ["FLAGGED_SUSPECTED_BYPASS", "CONFIRMED_BYPASS", "DISMISSED_FALSE_POSITIVE"],
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        institute: { select: { name: true } },
        admission: {
          select: {
            studentName: true,
            courseName: true,
            totalFee: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.commissionLedgerEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 120,
      include: {
        institute: { select: { name: true } },
        admission: { select: { studentName: true, status: true } },
        voucher: { select: { voucherCode: true } },
      },
    }),
    prisma.batchBuyCommissionInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        institute: { select: { name: true } },
        payments: { orderBy: { paidAt: "desc" } },
        creditNotes: { select: { appliedToInvoiceBalance: true } },
        _count: { select: { entries: true } },
      },
    }),
    prisma.batchBuyCreditNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        institute: { select: { name: true } },
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    prisma.batchBuyAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        actor: { select: { name: true } },
      },
    }),
  ]);

  return {
    success: true as const,
    institutes: institutes.map((inst) => ({
      id: inst.id,
      name: inst.name,
      city: inst.city?.name ?? null,
      subscriptionPlan: String(inst.subscriptionPlan),
    })),
    agreements: agreements.map((a) => ({
      id: a.id,
      instituteId: a.instituteId,
      instituteName: a.institute.name,
      instituteCity: a.institute.city?.name ?? null,
      version: a.version,
      rateTier: a.rateTier,
      commissionRatePct: Number(a.commissionRatePct),
      status: a.status,
      effectiveFrom: a.effectiveFrom.toISOString(),
      effectiveTo: a.effectiveTo ? a.effectiveTo.toISOString() : null,
      attributionWindowDays: a.attributionWindowDays,
      holdingPeriodDays: a.holdingPeriodDays,
      sacCode: a.sacCode,
      sacValidatedByCa: a.sacValidatedByCa,
      caValidatorName: a.caValidatorName,
      caMembershipNumber: a.caMembershipNumber,
      caValidatedAt: a.caValidatedAt ? a.caValidatedAt.toISOString() : null,
      gstRatePct: Number(a.gstRatePct),
      gstTreatmentNote: a.gstTreatmentNote,
      acceptedRepresentativeName: a.acceptedRepresentativeName,
      acceptedDesignation: a.acceptedDesignation,
      acceptedAt: a.acceptedAt ? a.acceptedAt.toISOString() : null,
    })),
    attributions: flaggedAttributions.map((a) => ({
      id: a.id,
      instituteId: a.instituteId,
      instituteName: a.institute.name,
      admissionId: a.admissionId,
      enquiryId: a.enquiryId,
      studentName: a.admission.studentName,
      courseName: a.admission.courseName,
      admissionTotalFee: a.admission.totalFee,
      admissionCreatedAt: a.admission.createdAt.toISOString(),
      sourceType: a.sourceType,
      matchStatus: a.matchStatus,
      attributionWindowDaysUsed: a.attributionWindowDaysUsed,
      evidenceJson:
        a.evidenceJson && typeof a.evidenceJson === "object"
          ? (a.evidenceJson as Record<string, unknown>)
          : null,
      reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
      reviewNote: a.reviewNote,
      createdAt: a.createdAt.toISOString(),
    })),
    ledgerEntries: ledgerEntries.map((e) => ({
      id: e.id,
      instituteId: e.instituteId,
      instituteName: e.institute.name,
      admissionId: e.admissionId,
      studentName: e.admission.studentName,
      admissionStatus: e.admission.status,
      voucherCode: e.voucher?.voucherCode ?? null,
      invoiceId: e.invoiceId,
      status: e.status,
      commissionableTuition: Number(e.commissionableTuition),
      excludedNonTuitionAmount: Number(e.excludedNonTuitionAmount),
      commissionRatePct: Number(e.commissionRatePct),
      commissionAmount: Number(e.commissionAmount),
      gstRatePct: Number(e.gstRatePct),
      gstAmount: Number(e.gstAmount),
      totalPayableAmount: Number(e.totalPayableAmount),
      redeemedAt: e.redeemedAt.toISOString(),
      holdEndsAt: e.holdEndsAt.toISOString(),
      isHoldElapsed: e.holdEndsAt <= now,
      maturedAt: e.maturedAt ? e.maturedAt.toISOString() : null,
      voidReason: e.voidReason,
    })),
    invoices: invoices.map((inv) => {
      const appliedCredit = inv.creditNotes.reduce(
        (sum, cn) => sum + Number(cn.appliedToInvoiceBalance),
        0
      );
      const effectiveBalance = Math.max(
        0,
        Math.round((Number(inv.totalPayableAmount) - appliedCredit - Number(inv.amountPaid)) * 100) /
          100
      );
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        instituteId: inv.instituteId,
        instituteName: inv.institute.name,
        periodStart: inv.periodStart.toISOString(),
        periodEnd: inv.periodEnd.toISOString(),
        issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
        dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
        dueDaysUsed: inv.dueDaysUsed,
        subtotalCommission: Number(inv.subtotalCommission),
        cgstAmount: Number(inv.cgstAmount),
        sgstAmount: Number(inv.sgstAmount),
        igstAmount: Number(inv.igstAmount),
        gstTotalAmount: Number(inv.gstTotalAmount),
        totalPayableAmount: Number(inv.totalPayableAmount),
        appliedCreditAmount: Math.round(appliedCredit * 100) / 100,
        effectiveCollectibleBalance: effectiveBalance,
        amountPaid: Number(inv.amountPaid),
        status: inv.status,
        taxTreatmentMode: inv.taxTreatmentMode,
        sacCodeUsed: inv.sacCodeUsed,
        sacValidationDisclaimer: inv.sacValidationDisclaimer,
        instituteGstinSnapshot: inv.instituteGstinSnapshot,
        academyFindGstin: inv.academyFindGstin,
        notes: inv.notes,
        entryCount: inv._count.entries,
        payments: inv.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentMode: p.paymentMode,
          utrOrReference: p.utrOrReference,
          paidAt: p.paidAt.toISOString(),
          note: p.note,
        })),
      };
    }),
    creditNotes: creditNotes.map((cn) => ({
      id: cn.id,
      creditNoteNumber: cn.creditNoteNumber,
      instituteId: cn.instituteId,
      instituteIdSnapshot: cn.instituteIdSnapshot,
      instituteName: cn.institute?.name ?? null,
      invoiceId: cn.invoiceId,
      invoiceNumber: cn.invoice.invoiceNumber,
      commissionEntryId: cn.commissionEntryId,
      admissionId: cn.admissionId,
      reasonType: cn.reasonType,
      status: cn.status,
      originalLedgerStatus: cn.originalLedgerStatus,
      originalInvoiceStatus: cn.originalInvoiceStatus,
      commissionReversalAmount: Number(cn.commissionReversalAmount),
      cgstReversalAmount: Number(cn.cgstReversalAmount),
      sgstReversalAmount: Number(cn.sgstReversalAmount),
      igstReversalAmount: Number(cn.igstReversalAmount),
      gstReversalTotal: Number(cn.gstReversalTotal),
      totalCreditAmount: Number(cn.totalCreditAmount),
      appliedToInvoiceBalance: Number(cn.appliedToInvoiceBalance),
      refundPayableToInstitute: Number(cn.refundPayableToInstitute),
      taxTreatmentModeUsed: cn.taxTreatmentModeUsed,
      sacCodeUsed: cn.sacCodeUsed,
      reason: cn.reason,
      settledRefundUtr: cn.settledRefundUtr,
      settledRefundAt: cn.settledRefundAt ? cn.settledRefundAt.toISOString() : null,
      createdAt: cn.createdAt.toISOString(),
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      instituteId: log.instituteId ?? log.instituteIdSnapshot,
      actorUserId: log.actorUserId,
      actorName: log.actor.name || log.actorRole,
      actorRole: log.actorRole,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      reason: log.reason,
      afterState:
        log.afterState && typeof log.afterState === "object"
          ? (log.afterState as Record<string, unknown>)
          : null,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}
