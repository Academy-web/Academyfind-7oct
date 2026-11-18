import {
  SaveInstituteAgreementSchema,
  computeCreditNoteAllocation,
  computeQuorumSettlementPlan,
} from "../../lib/batchbuy/commissionMath";
import { resolveQualifyingLowerSlabPctTx } from "../../lib/batchbuy/redemptionAuth";
import {
  reconcileOverlappingActiveAgreementsTx,
  windowsOverlap,
} from "../../lib/batchbuy/core/agreementCore";

jest.mock("../../app/generated/prisma/client", () => {
  class DecimalMock {
    value: string;
    constructor(val: string | number) {
      this.value = String(val);
    }
    toString() {
      return this.value;
    }
  }
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }
  return {
    Prisma: {
      Decimal: DecimalMock,
      PrismaClientKnownRequestError,
      TransactionIsolationLevel: {
        Serializable: "Serializable",
      },
      JsonNull: null,
    },
  };
});

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("../../lib/auth/auth", () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock("../../lib/prisma", () => ({
  prisma: {},
}));

describe("BatchBuy Audit Remediation: Boundary Schemas, Resolver, Credit Notes & Agreement Windows", () => {
  test("SaveInstituteAgreementSchema enforces >= 15d cooling-off hold and complete CA metadata on SAC sign-off", () => {
    const baseValid = {
      instituteId: "inst_1",
      rateTier: "STANDARD_3_PCT" as const,
      gstRatePct: 18,
      gstTreatmentNote: "18% GST segregated from B2B commission base per CA review.",
      sacCode: "998399",
      sacValidatedByCa: false,
      attributionWindowDays: 30,
      holdingPeriodDays: 15,
      paymentDueDays: 15,
      cancellationClawbackPolicy:
        "15-day cooling-off commercial hold; post-hold reversals issue B2B GST credit notes.",
      effectiveFrom: "2026-11-12T00:00:00.000Z",
      effectiveTo: null,
      activateImmediately: false,
    };

    expect(SaveInstituteAgreementSchema.safeParse(baseValid).success).toBe(true);

    // Rejects < 15 days cooling-off policy
    const shortHold = SaveInstituteAgreementSchema.safeParse({
      ...baseValid,
      holdingPeriodDays: 14,
    });
    expect(shortHold.success).toBe(false);

    // Rejects sacValidatedByCa = true without CA validator name or 6-digit ICAI number
    const missingCaMeta = SaveInstituteAgreementSchema.safeParse({
      ...baseValid,
      sacValidatedByCa: true,
      caValidatorName: "CA",
      caMembershipNumber: "123",
    });
    expect(missingCaMeta.success).toBe(false);

    // Accepts complete CA metadata + 6-digit SAC
    const validWithCa = SaveInstituteAgreementSchema.safeParse({
      ...baseValid,
      sacValidatedByCa: true,
      caValidatorName: "Raghavendra Kulkarni",
      caMembershipNumber: "145920",
      caValidationNote: "Confirmed SAC 998399 under B2B placement service.",
    });
    expect(validWithCa.success).toBe(true);
  });

  test("computeCreditNoteAllocation splits credit vs refundable excess cleanly in paise with GST treatment", () => {
    // 1. Unpaid issued invoice -> APPLIED_TO_INVOICE with zero cash refund payable
    const unpaidAlloc = computeCreditNoteAllocation({
      entryCommissionAmount: 3000,
      entryGstAmount: 540,
      taxTreatmentMode: "INTRA_STATE_CGST_SGST",
      invoiceTotalPayable: 7080,
      invoiceAmountPaid: 0,
      priorAppliedCredits: 0,
    });
    expect(unpaidAlloc.status).toBe("APPLIED_TO_INVOICE");
    expect(unpaidAlloc.cgstReversalStr).toBe("270.00");
    expect(unpaidAlloc.sgstReversalStr).toBe("270.00");
    expect(unpaidAlloc.igstReversalStr).toBe("0.00");
    expect(unpaidAlloc.appliedToInvoiceBalanceStr).toBe("3540.00");
    expect(unpaidAlloc.refundPayableToInstituteStr).toBe("0.00");

    // 2. Partially paid invoice -> absorbs remaining collectible balance then marks remainder REFUND_PENDING
    const partialPaidAlloc = computeCreditNoteAllocation({
      entryCommissionAmount: 3000,
      entryGstAmount: 540,
      taxTreatmentMode: "INTER_STATE_IGST",
      invoiceTotalPayable: 7080,
      invoiceAmountPaid: 5000,
      priorAppliedCredits: 0,
    });
    // Remaining collectible = 7080 - 5000 = 2080; Credit = 3540 -> 2080 applied, 1460 refundable
    expect(partialPaidAlloc.status).toBe("REFUND_PENDING");
    expect(partialPaidAlloc.igstReversalStr).toBe("540.00");
    expect(partialPaidAlloc.appliedToInvoiceBalanceStr).toBe("2080.00");
    expect(partialPaidAlloc.refundPayableToInstituteStr).toBe("1460.00");
  });

  test("resolveQualifyingLowerSlabPctTx queries non-archived active slabs and never falls back to institute defaults when batch override exists", async () => {
    const queries: unknown[] = [];
    const mockTx = {
      groupDiscountSlab: {
        findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          // Batch has active override only for 10-20 students (nothing for confirmedCount = 4)
          if (args.where.batchId === "batch_1") {
            return [{ minStudents: 10, maxStudents: 20, discountPercentage: "15.00" }];
          }
          // Institute default has 2-9 -> 8% (must NOT be used!)
          return [{ minStudents: 2, maxStudents: 9, discountPercentage: "8.00" }];
        }),
      },
    };

    const pct = await resolveQualifyingLowerSlabPctTx(mockTx as any, {
      instituteId: "inst_1",
      batchId: "batch_1",
      confirmedCount: 4,
    });

    expect(pct).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual(
      expect.objectContaining({
        instituteId: "inst_1",
        batchId: "batch_1",
        isActive: true,
        isArchived: false,
      })
    );
  });

  test("computeQuorumSettlementPlan covers ABSORB_SHORTFALL, REVERT_TO_LOWER_SLAB and CANCEL_DISCOUNT", () => {
    const absorb = computeQuorumSettlementPlan({
      baseFee: 120000,
      lockedOfferTuition: 102000,
      confirmedAdmissionsCount: 3,
      minAdmissionQuorum: 5,
      fallbackPolicy: "ABSORB_SHORTFALL",
      qualifyingLowerSlabPct: 5,
    });
    expect(absorb.postExpiryShortfallState).toBe("SETTLED_SHORTFALL_ABSORBED");
    expect(absorb.lockedTuitionStr).toBe("102000.00");
    expect(absorb.disclosedFallbackFeeStr).toBeNull();

    const revert = computeQuorumSettlementPlan({
      baseFee: 120000,
      lockedOfferTuition: 102000,
      confirmedAdmissionsCount: 3,
      minAdmissionQuorum: 5,
      fallbackPolicy: "REVERT_TO_LOWER_SLAB",
      qualifyingLowerSlabPct: 5,
    });
    expect(revert.postExpiryShortfallState).toBe("PENDING_STUDENT_FALLBACK_CONSENT");
    expect(revert.disclosedFallbackFeeStr).toBe("114000.00");

    const cancel = computeQuorumSettlementPlan({
      baseFee: 120000,
      lockedOfferTuition: 102000,
      confirmedAdmissionsCount: 3,
      minAdmissionQuorum: 5,
      fallbackPolicy: "CANCEL_DISCOUNT",
      qualifyingLowerSlabPct: 5,
    });
    expect(cancel.postExpiryShortfallState).toBe("PENDING_STUDENT_FALLBACK_CONSENT");
    expect(cancel.disclosedFallbackFeeStr).toBe("120000.00");
  });

  test("reconcileOverlappingActiveAgreementsTx closes prior open-ended agreement at exact boundary without gap", async () => {
    const updates: unknown[] = [];
    const newFrom = new Date("2026-11-12T00:00:00.000Z");
    const mockTx = {
      instituteBatchBuyAgreement: {
        findMany: jest.fn(async () => [
          {
            id: "ag_v1",
            version: 1,
            effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
            effectiveTo: null,
          },
        ]),
        update: jest.fn(async (arg: unknown) => {
          updates.push(arg);
          return arg;
        }),
      },
    };

    expect(
      windowsOverlap(
        new Date("2026-11-01T00:00:00.000Z"),
        newFrom,
        newFrom,
        null
      )
    ).toBe(false);

    await reconcileOverlappingActiveAgreementsTx(mockTx as any, {
      instituteId: "inst_1",
      excludeAgreementId: "ag_v2",
      newFrom,
      newTo: null,
      now: newFrom,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        where: { id: "ag_v1" },
        data: { status: "SUPERSEDED", effectiveTo: newFrom },
      })
    );
  });
});
