import { prisma } from "@/lib/prisma";
import { Prisma, type CommissionCreditNoteReason } from "@/app/generated/prisma/client";
import {
  ReviewFlaggedAttributionSchema,
  GenerateCommissionInvoiceSchema,
  RecordCommissionPaymentSchema,
  SettleCreditNoteRefundSchema,
  computeCommissionBreakdown,
  computeCreditNoteAllocation,
  toPaise,
  formatPaiseStr,
  type TaxTreatmentModeType,
} from "../commissionMath";
import { writeBatchBuyAuditLogTx } from "../redemptionAuth";
import { getActiveAgreementForInstituteTx } from "./agreementCore";

export const FINALIZED_VOUCHER_SETTLEMENT_STATES = [
  "SETTLED_FULL_DISCOUNT",
  "SETTLED_SHORTFALL_ABSORBED",
  "SETTLED_FALLBACK_ACCEPTED",
] as const;

/**
 * Prisma where-filter ensuring commissions tied to a voucher never mature or get invoiced
 * while quorum/fallback settlement is still open (`PROVISIONAL_QUORUM_OPEN`, etc.).
 */
export const finalizedCommissionSettlementWhere: Prisma.CommissionLedgerEntryWhereInput = {
  OR: [
    { voucherId: null },
    {
      voucher: {
        settlementState: {
          in: [...FINALIZED_VOUCHER_SETTLEMENT_STATES],
        },
      },
    },
  ],
};

function isSerializationError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2034" ||
      (err.code === "P2010" &&
        (err.message.includes("40001") ||
          err.message.toLowerCase().includes("could not serialize access"))))
  );
}

/**
 * Transactional core for adjudicating FLAGGED_SUSPECTED_BYPASS CRM admissions.
 * When confirmed, atomically revokes any candidate unredeemed voucher so the same student
 * cannot later double-redeem at the counter.
 */
export async function reviewFlaggedAttributionCore(
  rawInput: {
    attributionId: string;
    decision: "CONFIRMED_BYPASS" | "DISMISSED_FALSE_POSITIVE";
    reviewNote: string;
  },
  adminUserId: string
) {
  const parsed = ReviewFlaggedAttributionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid attribution review input.",
    };
  }

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "batchbuy_attribution" WHERE id = ${parsed.data.attributionId} FOR UPDATE`;

        const attr = await tx.batchBuyAttribution.findUnique({
          where: { id: parsed.data.attributionId },
          include: {
            admission: true,
            commission: { select: { id: true } },
          },
        });

        if (!attr) throw new Error("Attribution record not found.");
        if (attr.matchStatus !== "FLAGGED_SUSPECTED_BYPASS") {
          throw new Error(
            `Attribution is already ${attr.matchStatus} and cannot be re-adjudicated.`
          );
        }

        if (parsed.data.decision === "DISMISSED_FALSE_POSITIVE") {
          await tx.batchBuyAttribution.update({
            where: { id: attr.id },
            data: {
              matchStatus: "DISMISSED_FALSE_POSITIVE",
              reviewedById: adminUserId,
              reviewedAt: now,
              reviewNote: parsed.data.reviewNote.trim(),
            },
          });

          await writeBatchBuyAuditLogTx(tx, {
            instituteId: attr.instituteId,
            actorUserId: adminUserId,
            actorRole: "ADMIN",
            action: "BYPASS_DISMISSED",
            entityType: "BatchBuyAttribution",
            entityId: attr.id,
            beforeState: { matchStatus: "FLAGGED_SUSPECTED_BYPASS" },
            afterState: { matchStatus: "DISMISSED_FALSE_POSITIVE" },
            reason: parsed.data.reviewNote.trim(),
          });

          return {
            success: true as const,
            matchStatus: "DISMISSED_FALSE_POSITIVE",
            instituteId: attr.instituteId,
            commissionEntryId: null,
            revokedVoucherIds: [] as string[],
          };
        }

        // === CONFIRMED_BYPASS ===
        if (["CANCELLED", "REFUNDED"].includes(attr.admission.status)) {
          throw new Error(
            "Cannot confirm commission attribution for a cancelled/refunded admission."
          );
        }
        if (attr.commission) {
          throw new Error("A commission ledger entry already exists for this attribution.");
        }

        // Identify candidate unredeemed vouchers linked via evidenceJson or cohortMemberId
        const evidenceObj =
          attr.evidenceJson && typeof attr.evidenceJson === "object"
            ? (attr.evidenceJson as Record<string, unknown>)
            : null;
        const evidenceVoucherId =
          evidenceObj && typeof evidenceObj.candidateVoucherId === "string"
            ? evidenceObj.candidateVoucherId
            : null;

        const candidateVouchers = await tx.admissionVoucher.findMany({
          where: {
            instituteId: attr.instituteId,
            OR: [
              ...(evidenceVoucherId ? [{ id: evidenceVoucherId }] : []),
              ...(attr.cohortMemberId
                ? [{ cohortMemberId: attr.cohortMemberId }]
                : []),
            ],
          },
          select: { id: true, voucherCode: true, status: true },
        });

        const revokedVoucherIds: string[] = [];
        for (const cv of candidateVouchers) {
          await tx.$queryRaw`SELECT id FROM "admission_voucher" WHERE id = ${cv.id} FOR UPDATE`;
          const lockedVoucher = await tx.admissionVoucher.findUnique({
            where: { id: cv.id },
            select: { id: true, voucherCode: true, status: true },
          });
          if (!lockedVoucher) continue;

          if (lockedVoucher.status === "REDEEMED") {
            throw new Error(
              `Candidate voucher ${lockedVoucher.voucherCode} has already been redeemed at counter; cannot create duplicate bypass commission.`
            );
          }

          if (lockedVoucher.status === "ACTIVE" || lockedVoucher.status === "PENDING_QUORUM") {
            await tx.admissionVoucher.update({
              where: { id: lockedVoucher.id },
              data: {
                status: "REVOKED",
                revokedAt: now,
                revokeReason: `Revoked automatically upon confirmed CRM bypass attribution (${attr.id}).`,
              },
            });
            revokedVoucherIds.push(lockedVoucher.id);
          }
        }

        let ratePctNum: number | null = null;
        let gstRateNum = 18;
        let holdingDays = 15;
        let agreementId: string | null = null;

        if (attr.offerId) {
          const offer = await tx.cohortOffer.findUnique({
            where: { id: attr.offerId },
            select: {
              commissionAgreementId: true,
              commissionRatePctSnapshot: true,
              holdingPeriodDaysSnapshot: true,
              commissionAgreement: { select: { gstRatePct: true } },
            },
          });
          if (offer?.commissionRatePctSnapshot) {
            ratePctNum = Number(offer.commissionRatePctSnapshot);
            agreementId = offer.commissionAgreementId;
            holdingDays = Math.max(15, offer.holdingPeriodDaysSnapshot || 15);
            if (offer.commissionAgreement) {
              gstRateNum = Number(offer.commissionAgreement.gstRatePct);
            }
          }
        }

        if (ratePctNum === null) {
          const activeAgr = await getActiveAgreementForInstituteTx(
            tx,
            attr.instituteId,
            attr.admission.admissionDate
          );
          if (!activeAgr) {
            throw new Error(
              "No active BatchBuy Commercial Agreement found for this institute to compute confirmed commission."
            );
          }
          agreementId = activeAgr.id;
          ratePctNum = Number(activeAgr.commissionRatePct);
          gstRateNum = Number(activeAgr.gstRatePct);
          holdingDays = Math.max(15, activeAgr.holdingPeriodDays);
        }

        const settledTuition = attr.admission.batchBuySettledFee
          ? Number(attr.admission.batchBuySettledFee)
          : attr.admission.totalFee;

        const breakdown = computeCommissionBreakdown({
          commissionableTuition: settledTuition,
          excludedNonTuitionAmount: 0,
          commissionRatePct: ratePctNum,
          gstRatePct: gstRateNum,
          taxTreatmentMode: "PENDING_CA_VALIDATION",
        });

        const holdEndsAt = new Date(
          attr.admission.admissionDate.getTime() + holdingDays * 86_400_000
        );
        const alreadyMatured = holdEndsAt <= now;

        await tx.batchBuyAttribution.update({
          where: { id: attr.id },
          data: {
            sourceType: "BYPASS_RECOVERED",
            matchStatus: "CONFIRMED_BYPASS",
            reviewedById: adminUserId,
            reviewedAt: now,
            reviewNote: parsed.data.reviewNote.trim(),
          },
        });

        const ledger = await tx.commissionLedgerEntry.create({
          data: {
            instituteId: attr.instituteId,
            agreementId,
            admissionId: attr.admissionId,
            voucherId: null,
            attributionId: attr.id,
            commissionableTuition: new Prisma.Decimal(breakdown.commissionableTuitionStr),
            excludedNonTuitionAmount: new Prisma.Decimal("0.00"),
            excludedChargesNote: "Confirmed CRM attribution recovery (settled tuition basis).",
            commissionBaseRule: "SETTLED_TUITION_ONLY",
            commissionRatePct: new Prisma.Decimal(breakdown.commissionRatePctStr),
            commissionAmount: new Prisma.Decimal(breakdown.commissionAmountStr),
            gstRatePct: new Prisma.Decimal(breakdown.gstRatePctStr),
            gstAmount: new Prisma.Decimal(breakdown.gstAmountStr),
            totalPayableAmount: new Prisma.Decimal(breakdown.totalPayableAmountStr),
            status: alreadyMatured ? "ELIGIBLE" : "HOLD_PERIOD",
            redeemedAt: attr.admission.admissionDate,
            holdEndsAt,
            maturedAt: alreadyMatured ? now : null,
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: attr.instituteId,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: "BYPASS_CONFIRMED",
          entityType: "BatchBuyAttribution",
          entityId: attr.id,
          beforeState: { matchStatus: "FLAGGED_SUSPECTED_BYPASS" },
          afterState: {
            matchStatus: "CONFIRMED_BYPASS",
            commissionEntryId: ledger.id,
            commissionAmount: breakdown.commissionAmountStr,
            gstAmount: breakdown.gstAmountStr,
            revokedVoucherIds,
          },
          reason: parsed.data.reviewNote.trim(),
        });

        return {
          success: true as const,
          matchStatus: "CONFIRMED_BYPASS",
          instituteId: attr.instituteId,
          commissionEntryId: ledger.id,
          revokedVoucherIds,
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
    console.error("Failed attribution adjudication:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent update detected while reviewing attribution; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to review attribution case.",
    };
  }
}

/**
 * Transitions verified HOLD_PERIOD commissions to ELIGIBLE ONLY once BOTH:
 * 1. The 15+ day cooling-off hold has elapsed on a CONFIRMED admission, AND
 * 2. Voucher settlement is finalized (never `PROVISIONAL_QUORUM_OPEN` or `PENDING_STUDENT_FALLBACK_CONSENT`).
 */
export async function matureEligibleCommissionsCore(
  instituteId: string | undefined,
  adminUserId: string
) {
  const now = new Date();
  const candidates = await prisma.commissionLedgerEntry.findMany({
    where: {
      ...(instituteId ? { instituteId } : {}),
      status: "HOLD_PERIOD",
      holdEndsAt: { lte: now },
      admission: { status: "CONFIRMED" },
      attribution: { matchStatus: { in: ["VERIFIED", "CONFIRMED_BYPASS"] } },
      ...finalizedCommissionSettlementWhere,
    },
    select: { id: true, instituteId: true },
  });

  if (candidates.length === 0) {
    return { success: true as const, maturedCount: 0 };
  }

  const maturedIds = candidates.map((c) => c.id);

  await prisma.$transaction(async (tx) => {
    await tx.commissionLedgerEntry.updateMany({
      where: {
        id: { in: maturedIds },
        status: "HOLD_PERIOD",
        admission: { status: "CONFIRMED" },
        ...finalizedCommissionSettlementWhere,
      },
      data: {
        status: "ELIGIBLE",
        maturedAt: now,
      },
    });

    const touchedInstitutes = Array.from(new Set(candidates.map((c) => c.instituteId)));
    for (const instId of touchedInstitutes) {
      await writeBatchBuyAuditLogTx(tx, {
        instituteId: instId,
        actorUserId: adminUserId,
        actorRole: "ADMIN",
        action: "COMMISSIONS_MATURED",
        entityType: "CommissionLedgerEntry",
        entityId: instId,
        afterState: {
          maturedEntryIds: candidates.filter((c) => c.instituteId === instId).map((c) => c.id),
          maturedAt: now.toISOString(),
        },
      });
    }
  });

  return { success: true as const, maturedCount: candidates.length };
}

/**
 * Generates a GST-segregated B2B commission invoice for matured ELIGIBLE admissions.
 * Prevents issuing invoices when taxTreatmentMode is PENDING_CA_VALIDATION or CA validation is missing.
 */
export async function generateCommissionInvoiceCore(
  rawInput: {
    instituteId: string;
    periodStart: string;
    periodEnd: string;
    taxTreatmentMode?: TaxTreatmentModeType;
    sacCodeOverride?: string | null;
    instituteGstin?: string | null;
    academyFindGstin?: string | null;
    notes?: string | null;
    issueImmediately?: boolean;
  },
  adminUserId: string
) {
  const parsed = GenerateCommissionInvoiceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid invoice generation parameters.",
    };
  }

  const input = parsed.data;
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodEnd < periodStart
  ) {
    return { success: false as const, error: "Invalid invoice billing period dates." };
  }

  if (input.issueImmediately && input.taxTreatmentMode === "PENDING_CA_VALIDATION") {
    return {
      success: false as const,
      error:
        "Cannot issue a GST commission invoice while taxTreatmentMode is PENDING_CA_VALIDATION. Save as DRAFT or select INTRA_STATE_CGST_SGST / INTER_STATE_IGST after CA sign-off.",
    };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "Institute" WHERE id = ${input.instituteId} FOR UPDATE`;

        // Auto-mature strictly finalized CONFIRMED items whose hold window completed
        await tx.commissionLedgerEntry.updateMany({
          where: {
            instituteId: input.instituteId,
            status: "HOLD_PERIOD",
            holdEndsAt: { lte: now },
            admission: { status: "CONFIRMED" },
            attribution: { matchStatus: { in: ["VERIFIED", "CONFIRMED_BYPASS"] } },
            ...finalizedCommissionSettlementWhere,
          },
          data: { status: "ELIGIBLE", maturedAt: now },
        });

        const eligibleEntries = await tx.commissionLedgerEntry.findMany({
          where: {
            instituteId: input.instituteId,
            status: "ELIGIBLE",
            invoiceId: null,
            creditNote: { is: null },
            redeemedAt: { gte: periodStart, lte: periodEnd },
            admission: { status: "CONFIRMED" },
            ...finalizedCommissionSettlementWhere,
          },
          include: {
            agreement: {
              select: {
                sacCode: true,
                sacValidatedByCa: true,
                caValidatorName: true,
                caMembershipNumber: true,
                paymentDueDays: true,
              },
            },
          },
        });

        if (eligibleEntries.length === 0) {
          return {
            success: false as const,
            error:
              "No finalized, matured ELIGIBLE commission entries found for this institute and billing period.",
          };
        }

        const primaryAgreement = eligibleEntries.find((e) => e.agreement)?.agreement ?? null;
        const sacValidated = Boolean(
          primaryAgreement?.sacValidatedByCa &&
            primaryAgreement?.caValidatorName &&
            primaryAgreement?.caMembershipNumber
        );
        const sacUsed = input.sacCodeOverride?.trim() || primaryAgreement?.sacCode || null;

        if (input.issueImmediately && (!sacValidated || !sacUsed)) {
          return {
            success: false as const,
            error:
              "Cannot issue GST invoice: agreement lacks CA-validated SAC sign-off metadata (CA name & ICAI membership number). Create a DRAFT invoice first.",
          };
        }

        let subtotalPaise = 0;
        let gstTotalPaise = 0;

        for (const entry of eligibleEntries) {
          subtotalPaise += toPaise(Number(entry.commissionAmount));
          gstTotalPaise += toPaise(Number(entry.gstAmount));
        }

        let cgstPaise = 0;
        let sgstPaise = 0;
        let igstPaise = 0;
        if (input.taxTreatmentMode === "INTRA_STATE_CGST_SGST") {
          cgstPaise = Math.floor(gstTotalPaise / 2);
          sgstPaise = gstTotalPaise - cgstPaise;
        } else if (input.taxTreatmentMode === "INTER_STATE_IGST") {
          igstPaise = gstTotalPaise;
        }

        const totalPayablePaise = subtotalPaise + gstTotalPaise;
        const dueDaysUsed = primaryAgreement?.paymentDueDays ?? 15;

        const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
        const existingMonthCount = await tx.batchBuyCommissionInvoice.count({
          where: { invoiceNumber: { startsWith: `AF-BB-${yyyymm}-` } },
        });
        const suffix = String(existingMonthCount + 1).padStart(4, "0");
        const invoiceNumber = `AF-BB-${yyyymm}-${suffix}`;

        const invoice = await tx.batchBuyCommissionInvoice.create({
          data: {
            invoiceNumber,
            instituteId: input.instituteId,
            periodStart,
            periodEnd,
            issuedAt: input.issueImmediately ? now : null,
            dueAt: input.issueImmediately
              ? new Date(now.getTime() + dueDaysUsed * 86_400_000)
              : null,
            dueDaysUsed,
            subtotalCommission: new Prisma.Decimal(formatPaiseStr(subtotalPaise)),
            cgstAmount: new Prisma.Decimal(formatPaiseStr(cgstPaise)),
            sgstAmount: new Prisma.Decimal(formatPaiseStr(sgstPaise)),
            igstAmount: new Prisma.Decimal(formatPaiseStr(igstPaise)),
            gstTotalAmount: new Prisma.Decimal(formatPaiseStr(gstTotalPaise)),
            totalPayableAmount: new Prisma.Decimal(formatPaiseStr(totalPayablePaise)),
            taxTreatmentMode: input.taxTreatmentMode,
            sacCodeUsed: sacUsed,
            sacValidationDisclaimer: sacValidated
              ? null
              : "SAC code & CGST/SGST vs IGST place-of-supply treatment require CA sign-off before statutory GST filing.",
            instituteGstinSnapshot: input.instituteGstin?.trim() || null,
            academyFindGstin: input.academyFindGstin?.trim() || null,
            status: input.issueImmediately ? "ISSUED" : "DRAFT",
            notes: input.notes?.trim() || null,
            createdById: adminUserId,
          },
        });

        await tx.commissionLedgerEntry.updateMany({
          where: { id: { in: eligibleEntries.map((e) => e.id) } },
          data: { invoiceId: invoice.id, status: "INVOICED" },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: input.instituteId,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: input.issueImmediately ? "INVOICE_ISSUED" : "INVOICE_DRAFTED",
          entityType: "BatchBuyCommissionInvoice",
          entityId: invoice.id,
          afterState: {
            invoiceNumber,
            entryCount: eligibleEntries.length,
            subtotalCommission: formatPaiseStr(subtotalPaise),
            gstTotalAmount: formatPaiseStr(gstTotalPaise),
            totalPayableAmount: formatPaiseStr(totalPayablePaise),
            taxTreatmentMode: input.taxTreatmentMode,
            sacValidated,
          },
        });

        return {
          success: true as const,
          instituteId: input.instituteId,
          invoiceId: invoice.id,
          invoiceNumber,
          status: invoice.status,
          entryCount: eligibleEntries.length,
          subtotalCommission: Number(formatPaiseStr(subtotalPaise)),
          gstTotalAmount: Number(formatPaiseStr(gstTotalPaise)),
          totalPayableAmount: Number(formatPaiseStr(totalPayablePaise)),
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
    console.error("Failed to generate commission invoice:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent invoice generation detected; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to generate commission invoice.",
    };
  }
}

/**
 * Transitions a DRAFT commission invoice to ISSUED inside a Serializable row-locked tx,
 * blocking issuance unless GST place-of-supply split and CA validation are finalized.
 */
export async function issueCommissionInvoiceCore(
  invoiceId: string,
  adminUserId: string,
  overrideTaxMode?: TaxTreatmentModeType
) {
  if (!invoiceId) {
    return { success: false as const, error: "Invoice ID is required." };
  }

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "batchbuy_commission_invoice" WHERE id = ${invoiceId} FOR UPDATE`;

        const inv = await tx.batchBuyCommissionInvoice.findUnique({
          where: { id: invoiceId },
          include: {
            entries: {
              select: {
                id: true,
                agreement: {
                  select: {
                    sacCode: true,
                    sacValidatedByCa: true,
                    caValidatorName: true,
                    caMembershipNumber: true,
                  },
                },
              },
            },
          },
        });
        if (!inv) throw new Error("Invoice not found.");
        if (inv.status !== "DRAFT") {
          throw new Error(`Invoice ${inv.invoiceNumber} is already ${inv.status}.`);
        }

        const effectiveTaxMode = (overrideTaxMode ?? inv.taxTreatmentMode) as TaxTreatmentModeType;
        if (effectiveTaxMode === "PENDING_CA_VALIDATION") {
          throw new Error(
            "Cannot issue a GST invoice while taxTreatmentMode is PENDING_CA_VALIDATION."
          );
        }

        const linkedAgreement = inv.entries.find((e) => e.agreement)?.agreement ?? null;
        const sacValidated = linkedAgreement
          ? Boolean(
              linkedAgreement.sacValidatedByCa &&
                linkedAgreement.caValidatorName &&
                linkedAgreement.caMembershipNumber
            )
          : false;
        const effectiveSac = inv.sacCodeUsed || linkedAgreement?.sacCode || null;

        if (!sacValidated || !effectiveSac) {
          throw new Error(
            "Cannot issue GST invoice: linked agreement lacks CA-validated SAC sign-off metadata."
          );
        }

        const gstTotalPaise = toPaise(Number(inv.gstTotalAmount));
        let cgstPaise = toPaise(Number(inv.cgstAmount));
        let sgstPaise = toPaise(Number(inv.sgstAmount));
        let igstPaise = toPaise(Number(inv.igstAmount));

        if (overrideTaxMode || cgstPaise + sgstPaise + igstPaise !== gstTotalPaise) {
          if (effectiveTaxMode === "INTRA_STATE_CGST_SGST") {
            cgstPaise = Math.floor(gstTotalPaise / 2);
            sgstPaise = gstTotalPaise - cgstPaise;
            igstPaise = 0;
          } else if (effectiveTaxMode === "INTER_STATE_IGST") {
            cgstPaise = 0;
            sgstPaise = 0;
            igstPaise = gstTotalPaise;
          }
        }

        const issued = await tx.batchBuyCommissionInvoice.update({
          where: { id: inv.id },
          data: {
            status: "ISSUED",
            taxTreatmentMode: effectiveTaxMode,
            sacCodeUsed: effectiveSac,
            sacValidationDisclaimer: null,
            cgstAmount: new Prisma.Decimal(formatPaiseStr(cgstPaise)),
            sgstAmount: new Prisma.Decimal(formatPaiseStr(sgstPaise)),
            igstAmount: new Prisma.Decimal(formatPaiseStr(igstPaise)),
            issuedAt: now,
            dueAt: new Date(now.getTime() + inv.dueDaysUsed * 86_400_000),
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: inv.instituteId,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: "INVOICE_ISSUED",
          entityType: "BatchBuyCommissionInvoice",
          entityId: inv.id,
          beforeState: { status: "DRAFT" },
          afterState: {
            status: "ISSUED",
            taxTreatmentMode: effectiveTaxMode,
            sacCodeUsed: effectiveSac,
            issuedAt: now.toISOString(),
          },
        });

        return issued;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return {
      success: true as const,
      instituteId: updated.instituteId,
      invoiceId: updated.id,
      status: updated.status,
    };
  } catch (err: unknown) {
    console.error("Failed to issue commission invoice:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent invoice update detected; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to issue commission invoice.",
    };
  }
}

export async function recordCommissionPaymentCore(
  rawInput: {
    invoiceId: string;
    amount: number;
    paymentMode: "NEFT" | "RTGS" | "IMPS" | "UPI_B2B" | "RAZORPAY_B2B_LINK" | "CHEQUE";
    utrOrReference: string;
    paidAt?: string | null;
    note?: string | null;
  },
  adminUserId: string
) {
  const parsed = RecordCommissionPaymentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid commission payment details.",
    };
  }

  const input = parsed.data;
  const utrNormalized = input.utrOrReference.trim().toUpperCase();
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return { success: false as const, error: "Invalid payment date." };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "batchbuy_commission_invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;

        const invoice = await tx.batchBuyCommissionInvoice.findUnique({
          where: { id: input.invoiceId },
        });
        if (!invoice) throw new Error("Commission invoice not found.");
        if (["VOID", "PAID"].includes(invoice.status)) {
          return {
            success: false as const,
            error: `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot accept further payments.`,
          };
        }

        const existingPayment = await tx.commissionPaymentRecord.findUnique({
          where: { utrOrReference: utrNormalized },
          select: { id: true },
        });
        if (existingPayment) {
          return {
            success: false as const,
            error: `UTR / payment reference ${utrNormalized} has already been recorded (idempotent guard).`,
          };
        }

        const creditAgg = tx.batchBuyCreditNote?.aggregate
          ? await tx.batchBuyCreditNote.aggregate({
              where: {
                invoiceId: invoice.id,
                status: { in: ["APPLIED_TO_INVOICE", "ISSUED", "REFUND_PENDING", "REFUNDED"] },
              },
              _sum: { appliedToInvoiceBalance: true },
            })
          : { _sum: { appliedToInvoiceBalance: null } };

        const appliedCreditsPaise = toPaise(
          Number(creditAgg._sum.appliedToInvoiceBalance ?? 0)
        );
        const totalPayablePaise = toPaise(Number(invoice.totalPayableAmount));
        const effectivePayablePaise = Math.max(0, totalPayablePaise - appliedCreditsPaise);
        const currentPaidPaise = toPaise(Number(invoice.amountPaid));
        const addPaise = toPaise(input.amount);

        if (currentPaidPaise >= effectivePayablePaise) {
          return {
            success: false as const,
            error: `Invoice ${invoice.invoiceNumber} has no remaining collectible balance after applied credit notes.`,
          };
        }

        const newPaidPaise = currentPaidPaise + addPaise;
        const nextStatus = newPaidPaise >= effectivePayablePaise ? "PAID" : "PARTIALLY_PAID";

        const payment = await tx.commissionPaymentRecord.create({
          data: {
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(formatPaiseStr(addPaise)),
            paymentMode: input.paymentMode,
            utrOrReference: utrNormalized,
            paidAt,
            recordedById: adminUserId,
            verifiedById: adminUserId,
            verifiedAt: now,
            note: input.note?.trim() || null,
          },
        });

        await tx.batchBuyCommissionInvoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: new Prisma.Decimal(formatPaiseStr(newPaidPaise)),
            status: nextStatus,
          },
        });

        if (nextStatus === "PAID") {
          await tx.commissionLedgerEntry.updateMany({
            where: {
              invoiceId: invoice.id,
              status: "INVOICED",
              creditNote: { is: null },
            },
            data: { status: "SETTLED" },
          });
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: invoice.instituteId,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: "PAYMENT_RECORDED",
          entityType: "BatchBuyCommissionInvoice",
          entityId: invoice.id,
          beforeState: {
            amountPaid: invoice.amountPaid.toString(),
            status: invoice.status,
          },
          afterState: {
            paymentId: payment.id,
            utrOrReference: utrNormalized,
            amountAdded: formatPaiseStr(addPaise),
            newAmountPaid: formatPaiseStr(newPaidPaise),
            effectivePayable: formatPaiseStr(effectivePayablePaise),
            status: nextStatus,
          },
        });

        return {
          success: true as const,
          instituteId: invoice.instituteId,
          paymentId: payment.id,
          invoiceNumber: invoice.invoiceNumber,
          status: nextStatus,
          amountPaid: Number(formatPaiseStr(newPaidPaise)),
          remainingBalance: Number(
            formatPaiseStr(Math.max(0, effectivePayablePaise - newPaidPaise))
          ),
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
    console.error("Failed to record commission payment:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent payment recording conflict; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to record payment.",
    };
  }
}

/**
 * Transactional append-only commission reversal helper:
 * - Uninvoiced (`invoiceId === null`): transitions ledger directly (`VOIDED_COOLING_OFF` / `CLAWED_BACK`).
 * - Linked to `DRAFT` invoice: detaches entry and recalculates the draft invoice cleanly (voiding draft if empty).
 * - Linked to `ISSUED` / `PARTIALLY_PAID` / `PAID` / `OVERDUE` / `DISPUTED` invoice:
 *   NEVER overwrites `INVOICED`/`SETTLED` ledger status or original invoice/payment totals;
 *   creates an immutable idempotent `BatchBuyCreditNote` allocating commission & GST reversals + refund payable.
 */
export async function reverseCommissionEntryTx(
  tx: Prisma.TransactionClient,
  params: {
    commissionEntryId: string;
    admissionId: string;
    instituteId: string;
    reasonType: CommissionCreditNoteReason;
    reasonText: string;
    actorUserId: string;
    actorRole: string;
    now: Date;
  }
): Promise<{
  outcome: "VOIDED_COOLING_OFF" | "CLAWED_BACK" | "CREDIT_NOTE_ISSUED";
  creditNoteId?: string;
  creditNoteNumber?: string;
  refundPayableToInstitute?: number;
}> {
  await tx.$queryRaw`SELECT id FROM "batchbuy_commission_ledger" WHERE id = ${params.commissionEntryId} FOR UPDATE`;

  const entry = await tx.commissionLedgerEntry.findUnique({
    where: { id: params.commissionEntryId },
    include: {
      invoice: true,
      creditNote: true,
    },
  });

  if (!entry) {
    throw new Error("Commission ledger entry not found during reversal.");
  }

  // Case 3: Invoice already issued or paid -> immutable Credit Note path
  if (entry.invoiceId && entry.invoice && entry.invoice.status !== "DRAFT") {
    const invoice = entry.invoice;
    await tx.$queryRaw`SELECT id FROM "batchbuy_commission_invoice" WHERE id = ${invoice.id} FOR UPDATE`;

    if (entry.creditNote) {
      return {
        outcome: "CREDIT_NOTE_ISSUED",
        creditNoteId: entry.creditNote.id,
        creditNoteNumber: entry.creditNote.creditNoteNumber,
        refundPayableToInstitute: Number(entry.creditNote.refundPayableToInstitute),
      };
    }

    const priorCreditsAgg = await tx.batchBuyCreditNote.aggregate({
      where: {
        invoiceId: invoice.id,
        status: { in: ["APPLIED_TO_INVOICE", "ISSUED", "REFUND_PENDING", "REFUNDED"] },
      },
      _sum: { appliedToInvoiceBalance: true },
    });

    const allocation = computeCreditNoteAllocation({
      entryCommissionAmount: Number(entry.commissionAmount),
      entryGstAmount: Number(entry.gstAmount),
      taxTreatmentMode: invoice.taxTreatmentMode,
      invoiceTotalPayable: Number(invoice.totalPayableAmount),
      invoiceAmountPaid: Number(invoice.amountPaid),
      priorAppliedCredits: Number(priorCreditsAgg._sum.appliedToInvoiceBalance ?? 0),
    });

    const yyyymm = `${params.now.getFullYear()}${String(params.now.getMonth() + 1).padStart(2, "0")}`;
    const existingCnCount = await tx.batchBuyCreditNote.count({
      where: { creditNoteNumber: { startsWith: `AF-CN-${yyyymm}-` } },
    });
    const creditNoteNumber = `AF-CN-${yyyymm}-${String(existingCnCount + 1).padStart(4, "0")}`;
    const idempotencyKey = `CN:${entry.id}`;

    const createdCn = await tx.batchBuyCreditNote.create({
      data: {
        creditNoteNumber,
        idempotencyKey,
        instituteId: params.instituteId,
        instituteIdSnapshot: params.instituteId,
        invoiceId: invoice.id,
        commissionEntryId: entry.id,
        admissionId: params.admissionId,
        reasonType: params.reasonType,
        status: allocation.status,
        originalLedgerStatus: entry.status,
        originalInvoiceStatus: invoice.status,
        commissionReversalAmount: new Prisma.Decimal(allocation.commissionReversalStr),
        cgstReversalAmount: new Prisma.Decimal(allocation.cgstReversalStr),
        sgstReversalAmount: new Prisma.Decimal(allocation.sgstReversalStr),
        igstReversalAmount: new Prisma.Decimal(allocation.igstReversalStr),
        gstReversalTotal: new Prisma.Decimal(allocation.gstReversalTotalStr),
        totalCreditAmount: new Prisma.Decimal(allocation.totalCreditStr),
        appliedToInvoiceBalance: new Prisma.Decimal(allocation.appliedToInvoiceBalanceStr),
        refundPayableToInstitute: new Prisma.Decimal(allocation.refundPayableToInstituteStr),
        taxTreatmentModeUsed: invoice.taxTreatmentMode,
        sacCodeUsed: invoice.sacCodeUsed,
        reason: params.reasonText,
        createdById: params.actorUserId,
      },
    });

    await writeBatchBuyAuditLogTx(tx, {
      instituteId: params.instituteId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: "CREDIT_NOTE_ISSUED",
      entityType: "BatchBuyCreditNote",
      entityId: createdCn.id,
      beforeState: {
        ledgerStatus: entry.status,
        invoiceStatus: invoice.status,
        invoiceTotalPayable: invoice.totalPayableAmount.toString(),
        invoiceAmountPaid: invoice.amountPaid.toString(),
      },
      afterState: {
        creditNoteNumber,
        reasonType: params.reasonType,
        status: allocation.status,
        commissionReversalAmount: allocation.commissionReversalStr,
        gstReversalTotal: allocation.gstReversalTotalStr,
        totalCreditAmount: allocation.totalCreditStr,
        appliedToInvoiceBalance: allocation.appliedToInvoiceBalanceStr,
        refundPayableToInstitute: allocation.refundPayableToInstituteStr,
        preservedLedgerStatus: entry.status,
      },
      reason: params.reasonText,
    });

    return {
      outcome: "CREDIT_NOTE_ISSUED",
      creditNoteId: createdCn.id,
      creditNoteNumber,
      refundPayableToInstitute: Number(allocation.refundPayableToInstituteStr),
    };
  }

  // Case 1 & 2: Uninvoiced OR still on an unissued DRAFT invoice
  const withinHold =
    params.reasonType === "FALLBACK_DECLINED" ||
    (params.now <= entry.holdEndsAt && entry.status === "HOLD_PERIOD");
  const nextStatus = withinHold ? "VOIDED_COOLING_OFF" : "CLAWED_BACK";

  if (entry.invoiceId && entry.invoice && entry.invoice.status === "DRAFT") {
    const draftInv = entry.invoice;
    await tx.$queryRaw`SELECT id FROM "batchbuy_commission_invoice" WHERE id = ${draftInv.id} FOR UPDATE`;

    await tx.commissionLedgerEntry.update({
      where: { id: entry.id },
      data: {
        status: nextStatus,
        invoiceId: null,
        voidReason: params.reasonText,
      },
    });

    const remainingEntries = await tx.commissionLedgerEntry.findMany({
      where: { invoiceId: draftInv.id },
      select: { commissionAmount: true, gstAmount: true },
    });

    let subPaise = 0;
    let gstPaise = 0;
    for (const rem of remainingEntries) {
      subPaise += toPaise(Number(rem.commissionAmount));
      gstPaise += toPaise(Number(rem.gstAmount));
    }
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    if (draftInv.taxTreatmentMode === "INTRA_STATE_CGST_SGST") {
      cgstPaise = Math.floor(gstPaise / 2);
      sgstPaise = gstPaise - cgstPaise;
    } else if (draftInv.taxTreatmentMode === "INTER_STATE_IGST") {
      igstPaise = gstPaise;
    }

    await tx.batchBuyCommissionInvoice.update({
      where: { id: draftInv.id },
      data: {
        subtotalCommission: new Prisma.Decimal(formatPaiseStr(subPaise)),
        cgstAmount: new Prisma.Decimal(formatPaiseStr(cgstPaise)),
        sgstAmount: new Prisma.Decimal(formatPaiseStr(sgstPaise)),
        igstAmount: new Prisma.Decimal(formatPaiseStr(igstPaise)),
        gstTotalAmount: new Prisma.Decimal(formatPaiseStr(gstPaise)),
        totalPayableAmount: new Prisma.Decimal(formatPaiseStr(subPaise + gstPaise)),
        status: remainingEntries.length === 0 ? "VOID" : "DRAFT",
      },
    });

    await writeBatchBuyAuditLogTx(tx, {
      instituteId: params.instituteId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: "INVOICE_DRAFT_ADJUSTED",
      entityType: "BatchBuyCommissionInvoice",
      entityId: draftInv.id,
      beforeState: { subtotalCommission: draftInv.subtotalCommission.toString() },
      afterState: {
        detachedEntryId: entry.id,
        remainingEntries: remainingEntries.length,
        newTotalPayable: formatPaiseStr(subPaise + gstPaise),
        status: remainingEntries.length === 0 ? "VOID" : "DRAFT",
      },
      reason: params.reasonText,
    });
  } else {
    await tx.commissionLedgerEntry.update({
      where: { id: entry.id },
      data: {
        status: nextStatus,
        voidReason: params.reasonText,
      },
    });
  }

  return { outcome: nextStatus };
}

/**
 * Records B2B refund settlement against a REFUND_PENDING credit note (when original invoice was already paid).
 */
export async function settleCreditNoteRefundCore(
  rawInput: {
    creditNoteId: string;
    utrOrReference: string;
    settledAt?: string | null;
  },
  adminUserId: string
) {
  const parsed = SettleCreditNoteRefundSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid credit note refund details.",
    };
  }

  const utrNormalized = parsed.data.utrOrReference.trim().toUpperCase();
  const settledAt = parsed.data.settledAt ? new Date(parsed.data.settledAt) : new Date();
  if (Number.isNaN(settledAt.getTime())) {
    return { success: false as const, error: "Invalid refund settlement date." };
  }

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "batchbuy_credit_note" WHERE id = ${parsed.data.creditNoteId} FOR UPDATE`;

        const cn = await tx.batchBuyCreditNote.findUnique({
          where: { id: parsed.data.creditNoteId },
        });
        if (!cn) throw new Error("Credit note not found.");
        if (cn.status !== "REFUND_PENDING") {
          throw new Error(
            `Credit note ${cn.creditNoteNumber} is ${cn.status}, not REFUND_PENDING.`
          );
        }

        const dupUtr = await tx.batchBuyCreditNote.findUnique({
          where: { settledRefundUtr: utrNormalized },
          select: { id: true },
        });
        if (dupUtr) {
          throw new Error(`Refund UTR ${utrNormalized} is already recorded.`);
        }

        const res = await tx.batchBuyCreditNote.update({
          where: { id: cn.id },
          data: {
            status: "REFUNDED",
            settledRefundUtr: utrNormalized,
            settledRefundAt: settledAt,
          },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: cn.instituteIdSnapshot,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: "CREDIT_NOTE_REFUND_SETTLED",
          entityType: "BatchBuyCreditNote",
          entityId: cn.id,
          beforeState: { status: "REFUND_PENDING" },
          afterState: {
            status: "REFUNDED",
            settledRefundUtr: utrNormalized,
            refundPayableToInstitute: cn.refundPayableToInstitute.toString(),
          },
        });

        return res;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return {
      success: true as const,
      creditNoteId: updated.id,
      creditNoteNumber: updated.creditNoteNumber,
      instituteId: updated.instituteIdSnapshot,
      status: updated.status,
    };
  } catch (err: unknown) {
    console.error("Failed to settle credit note refund:", err);
    return {
      success: false as const,
      error: isSerializationError(err)
        ? "Concurrent credit note refund update; please retry."
        : err instanceof Error
        ? err.message
        : "Failed to settle credit note refund.",
    };
  }
}
