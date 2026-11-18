import {
  computeCommissionBreakdown,
  computeQuorumSettlementPlan,
  parseQrOrVoucherCodeInput,
} from "../../lib/batchbuy/commissionMath";
import { detectAndFlagPotentialBypassTx } from "../../lib/instituteSalesManager/admissionPipeline";
import { cancelOrRefundBatchBuyAdmissionAction } from "../../lib/batchbuy/redemptionActions";
import {
  reviewFlaggedAttributionAction,
  recordCommissionPaymentAction,
} from "../../lib/batchbuy/commissionActions";
import {
  verifyCounterRedemptionAccess,
  verifyPlatformAdminAccess,
  writeBatchBuyAuditLogTx,
} from "../../lib/batchbuy/redemptionAuth";
import { getActiveAgreementForInstituteTx } from "../../lib/batchbuy/core/agreementCore";
import { prisma } from "../../lib/prisma";
import { Prisma } from "../../app/generated/prisma/client";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("../../lib/auth/auth", () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock("../../lib/notifications/notify", () => ({
  notifyUser: jest.fn(async () => null),
}));

jest.mock("../../lib/batchbuy/redemptionAuth", () => ({
  verifyCounterRedemptionAccess: jest.fn(),
  verifyPlatformAdminAccess: jest.fn(),
  writeBatchBuyAuditLogTx: jest.fn(async () => undefined),
  resolveQualifyingLowerSlabPctTx: jest.fn(async () => null),
}));

jest.mock("../../lib/batchbuy/core/agreementCore", () => ({
  getActiveAgreementForInstituteTx: jest.fn(),
}));

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
    },
  };
});

jest.mock("../../lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    admissionRecord: { findUnique: jest.fn() },
    admissionVoucher: { findUnique: jest.fn() },
  },
}));

describe("BatchBuy Slice 4: Commissions, Two-Stage Quorum Settlement, Anti-Bypass & UTR Payments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("computes paise-exact 2%, 3%, 4% commissions strictly on settled tuition with separate GST", () => {
    // ₹1,08,000 settled tuition, ₹12,000 excluded hostel/books, 3% commission, +18% intra-state GST
    const intra = computeCommissionBreakdown({
      commissionableTuition: 108000,
      excludedNonTuitionAmount: 12000,
      commissionRatePct: 3,
      gstRatePct: 18,
      taxTreatmentMode: "INTRA_STATE_CGST_SGST",
    });

    expect(intra.commissionableTuition).toBe(108000);
    expect(intra.excludedNonTuitionAmount).toBe(12000);
    // 3% of 1,08,000 = 3,240.00 (excluded hostel does NOT inflate commission)
    expect(intra.commissionAmount).toBe(3240);
    // 18% GST on 3,240 = 583.20 -> CGST 291.60 + SGST 291.60
    expect(intra.gstAmount).toBe(583.2);
    expect(intra.cgstAmountStr).toBe("291.60");
    expect(intra.sgstAmountStr).toBe("291.60");
    expect(intra.igstAmountStr).toBe("0.00");
    expect(intra.totalPayableAmount).toBe(3823.2);

    // 2% partner tier vs 4% non-partner tier
    const partner2 = computeCommissionBreakdown({
      commissionableTuition: 100001,
      commissionRatePct: 2,
      taxTreatmentMode: "INTER_STATE_IGST",
    });
    expect(partner2.commissionAmount).toBe(2000.02);
    expect(partner2.igstAmountStr).toBe("360.00");

    const nonPartner4 = computeCommissionBreakdown({
      commissionableTuition: 100000,
      commissionRatePct: 4,
      taxTreatmentMode: "PENDING_CA_VALIDATION",
    });
    expect(nonPartner4.commissionAmount).toBe(4000);
    expect(nonPartner4.gstAmount).toBe(720);
    expect(nonPartner4.totalPayableAmount).toBe(4720);
  });

  test("evaluates minAdmissionQuorum fallback settlement cleanly without silent fee hikes", () => {
    // 1. ABSORB_SHORTFALL settles at locked offer price immediately
    const absorb = computeQuorumSettlementPlan({
      fallbackPolicy: "ABSORB_SHORTFALL",
      minAdmissionQuorum: 5,
      confirmedAdmissionsCount: 3,
      baseFee: 120000,
      lockedOfferTuition: 108000,
    });
    expect(absorb.requiresDisclosureAtCounter).toBe(false);
    expect(absorb.redemptionSettlementState).toBe("SETTLED_FULL_DISCOUNT");
    expect(absorb.postExpiryShortfallState).toBe("SETTLED_SHORTFALL_ABSORBED");

    // 2. REVERT_TO_LOWER_SLAB short of quorum -> provisional & requires student consent after expiry
    const revertShort = computeQuorumSettlementPlan({
      fallbackPolicy: "REVERT_TO_LOWER_SLAB",
      minAdmissionQuorum: 5,
      confirmedAdmissionsCount: 4,
      baseFee: 120000,
      lockedOfferTuition: 102000, // 15% off
      qualifyingLowerSlabPct: 5, // 5% off fallback -> 114000
    });
    expect(revertShort.isAdmissionQuorumMet).toBe(false);
    expect(revertShort.requiresDisclosureAtCounter).toBe(true);
    expect(revertShort.redemptionSettlementState).toBe("PROVISIONAL_QUORUM_OPEN");
    expect(revertShort.postExpiryShortfallState).toBe("PENDING_STUDENT_FALLBACK_CONSENT");
    expect(revertShort.disclosedFallbackFeeStr).toBe("114000.00");

    // 3. CANCEL_DISCOUNT meeting quorum settles at full offer discount
    const met = computeQuorumSettlementPlan({
      fallbackPolicy: "CANCEL_DISCOUNT",
      minAdmissionQuorum: 5,
      confirmedAdmissionsCount: 5,
      baseFee: 120000,
      lockedOfferTuition: 108000,
    });
    expect(met.isAdmissionQuorumMet).toBe(true);
    expect(met.redemptionSettlementState).toBe("SETTLED_FULL_DISCOUNT");
  });

  test("parses signed QR JSON payload and manual AFBB voucher code cleanly", () => {
    const qr = parseQrOrVoucherCodeInput(
      JSON.stringify({ v: 1, kid: "k1", code: "afbb-abcd-efgh-ijkl", sig: "abc" })
    );
    expect(qr.mode).toBe("QR_SCAN");
    expect(qr.voucherCode).toBe("AFBB-ABCD-EFGH-IJKL");
    expect(qr.qrPayloadRaw).not.toBeNull();

    const manual = parseQrOrVoucherCodeInput("  afbb-1234-5678-90ab ");
    expect(manual.mode).toBe("MANUAL_CODE");
    expect(manual.voucherCode).toBe("AFBB-1234-5678-90AB");
    expect(manual.qrPayloadRaw).toBeNull();
  });

  test("anti-bypass lookback flags CRM admission non-blockingly without auto-creating commission", async () => {
    const createAttribution = jest.fn(async ({ data }) => ({
      id: "attr_flag_1",
      ...data,
    }));
    const commissionCreate = jest.fn();

    const mockTx = {
      instituteBatchBuyAgreement: {
        findFirst: jest.fn(async () => ({ attributionWindowDays: 30 })),
      },
      groupCohortMember: {
        findMany: jest.fn(async () => [
          {
            id: "mem_1",
            joinedAt: new Date(Date.now() - 5 * 86_400_000),
            user: {
              id: "stu_1",
              name: "Aarav Verma",
              phone: "+91 98765 43210",
              email: "aarav@example.com",
            },
            cohort: { id: "coh_1", cohortCode: "BB-ALLEN-99", batchId: "batch_1" },
            vouchers: [
              {
                id: "v_1",
                voucherCode: "AFBB-TEST-1234-ABCD",
                offerId: "off_1",
                status: "ACTIVE",
                issuedAt: new Date(),
              },
            ],
          },
        ]),
      },
      batchBuyAttribution: {
        findUnique: jest.fn(async () => null),
        create: createAttribution,
      },
      commissionLedgerEntry: {
        create: commissionCreate,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await detectAndFlagPotentialBypassTx(mockTx, {
      admissionId: "adm_1",
      enquiryId: "enq_1",
      instituteId: "inst_1",
      leadName: "Aarav Verma",
      leadPhone: "9876543210",
      leadEmail: "aarav@example.com",
      actorUserId: "ism_1",
      actorRole: "INSTITUTE_SALES_MANAGER",
      now: new Date(),
    });

    expect(result.flagged).toBe(true);
    expect(createAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: "FLAGGED_SUSPECTED_BYPASS",
          sourceType: "COHORT_LEAD_MATCH",
          voucherId: null, // Must NOT lock unredeemed voucher
        }),
      })
    );
    // Phone match alone NEVER auto-creates commission liability
    expect(commissionCreate).not.toHaveBeenCalled();
    expect(writeBatchBuyAuditLogTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: "BYPASS_FLAGGED" })
    );
  });

  test("Platform ADMIN can dismiss false positive or confirm bypass into 15-day held ledger entry", async () => {
    (verifyPlatformAdminAccess as jest.Mock).mockResolvedValue({
      authorized: true,
      userId: "admin_1",
    });

    // 1. Dismiss false positive
    const dismissUpdate = jest.fn(async () => ({}));
    const dismissCommissionCreate = jest.fn();
    const dismissTx = {
      $queryRaw: jest.fn(async () => []),
      batchBuyAttribution: {
        findUnique: jest.fn(async () => ({
          id: "attr_1",
          instituteId: "inst_1",
          matchStatus: "FLAGGED_SUSPECTED_BYPASS",
          admission: { status: "CONFIRMED", totalFee: 90000 },
          commission: null,
        })),
        update: dismissUpdate,
      },
      commissionLedgerEntry: { create: dismissCommissionCreate },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(dismissTx));

    const dismissRes = await reviewFlaggedAttributionAction({
      attributionId: "attr_1",
      decision: "DISMISSED_FALSE_POSITIVE",
      reviewNote: "Sibling phone number, unrelated student admission.",
    });
    expect(dismissRes.success).toBe(true);
    expect("matchStatus" in dismissRes && dismissRes.matchStatus).toBe("DISMISSED_FALSE_POSITIVE");
    expect(dismissCommissionCreate).not.toHaveBeenCalled();

    // 2. Confirm bypass -> initializes 15-day HOLD_PERIOD ledger entry using active agreement
    (getActiveAgreementForInstituteTx as jest.Mock).mockResolvedValueOnce({
      id: "ag_2",
      commissionRatePct: new Prisma.Decimal("3.00"),
      gstRatePct: new Prisma.Decimal("18.00"),
      holdingPeriodDays: 15,
    });
    const confirmCommissionCreate = jest.fn(async ({ data }) => ({ id: "comm_1", ...data }));
    const confirmTx = {
      $queryRaw: jest.fn(async () => []),
      batchBuyAttribution: {
        findUnique: jest.fn(async () => ({
          id: "attr_2",
          instituteId: "inst_1",
          offerId: null,
          admissionId: "adm_2",
          cohortMemberId: "mem_2",
          matchStatus: "FLAGGED_SUSPECTED_BYPASS",
          admission: {
            id: "adm_2",
            status: "CONFIRMED",
            totalFee: 100000,
            batchBuySettledFee: null,
            admissionDate: new Date(Date.now() - 2 * 86_400_000),
          },
          commission: null,
        })),
        update: jest.fn(async () => ({})),
      },
      admissionVoucher: { findMany: jest.fn(async () => []) },
      commissionLedgerEntry: { create: confirmCommissionCreate },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(confirmTx));

    const confirmRes = await reviewFlaggedAttributionAction({
      attributionId: "attr_2",
      decision: "CONFIRMED_BYPASS",
      reviewNote: "Student enrolled offline after receiving Cohort Offer v1.",
    });
    expect(confirmRes.success).toBe(true);
    expect("matchStatus" in confirmRes && confirmRes.matchStatus).toBe("CONFIRMED_BYPASS");
    expect(confirmCommissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "HOLD_PERIOD",
          commissionRatePct: expect.objectContaining({ value: "3.00" }),
          commissionAmount: expect.objectContaining({ value: "3000.00" }),
          gstAmount: expect.objectContaining({ value: "540.00" }),
        }),
      })
    );
  });

  test("voids commission inside 15-day hold on cancellation and claws back post-hold cancellations", async () => {
    (verifyCounterRedemptionAccess as jest.Mock).mockResolvedValue({
      authorized: true,
      userId: "mgr_1",
      actorRole: "INSTITUTE_MANAGER",
    });

    // Inside hold
    (prisma.admissionRecord.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "adm_hold",
      instituteId: "inst_1",
      batchBuyVoucherId: "v_hold",
    });
    const holdUpdateLedger = jest.fn(async () => ({}));
    const holdCommissionEntry = {
      id: "c_hold",
      status: "HOLD_PERIOD",
      holdEndsAt: new Date(Date.now() + 5 * 86_400_000),
      invoiceId: null,
      invoice: null,
      creditNote: null,
    };
    const holdTx = {
      $queryRaw: jest.fn(async () => []),
      admissionRecord: {
        findUnique: jest.fn(async () => ({
          id: "adm_hold",
          instituteId: "inst_1",
          batchBuyVoucherId: "v_hold",
          status: "CONFIRMED",
          paidAmount: 25000,
          batchBuyVoucher: {
            id: "v_hold",
            cohortMemberId: "mem_hold",
            settlementState: "PROVISIONAL_QUORUM_OPEN",
            cohort: { cohortCode: "BB-1" },
          },
          commissionEntry: holdCommissionEntry,
        })),
        update: jest.fn(async () => ({})),
      },
      admissionVoucher: { update: jest.fn(async () => ({})) },
      groupCohortMember: { update: jest.fn(async () => ({})) },
      commissionLedgerEntry: {
        findUnique: jest.fn(async () => holdCommissionEntry),
        update: holdUpdateLedger,
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(holdTx));

    const insideRes = await cancelOrRefundBatchBuyAdmissionAction({
      admissionId: "adm_hold",
      reason: "Student opted out within 15-day cooling-off window.",
    });
    expect(insideRes.success).toBe(true);
    expect("commissionStatus" in insideRes && insideRes.commissionStatus).toBe(
      "VOIDED_COOLING_OFF"
    );
    expect(holdUpdateLedger).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "VOIDED_COOLING_OFF" }) })
    );

    // Post hold
    (prisma.admissionRecord.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "adm_past",
      instituteId: "inst_1",
      batchBuyVoucherId: "v_past",
    });
    const pastUpdateLedger = jest.fn(async () => ({}));
    const pastCommissionEntry = {
      id: "c_past",
      status: "ELIGIBLE",
      holdEndsAt: new Date(Date.now() - 86_400_000),
      invoiceId: null,
      invoice: null,
      creditNote: null,
    };
    const pastTx = {
      $queryRaw: jest.fn(async () => []),
      admissionRecord: {
        findUnique: jest.fn(async () => ({
          id: "adm_past",
          instituteId: "inst_1",
          batchBuyVoucherId: "v_past",
          status: "CONFIRMED",
          paidAmount: 25000,
          batchBuyVoucher: {
            id: "v_past",
            cohortMemberId: "mem_past",
            settlementState: "SETTLED_FULL_DISCOUNT",
            cohort: { cohortCode: "BB-1" },
          },
          commissionEntry: pastCommissionEntry,
        })),
        update: jest.fn(async () => ({})),
      },
      admissionVoucher: { update: jest.fn(async () => ({})) },
      groupCohortMember: { update: jest.fn(async () => ({})) },
      commissionLedgerEntry: {
        findUnique: jest.fn(async () => pastCommissionEntry),
        update: pastUpdateLedger,
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(pastTx));

    const postRes = await cancelOrRefundBatchBuyAdmissionAction({
      admissionId: "adm_past",
      reason: "Student transferred after cooling-off expired.",
      directRefundCompleted: true,
    });
    expect(postRes.success).toBe(true);
    expect("commissionStatus" in postRes && postRes.commissionStatus).toBe("CLAWED_BACK");
  });

  test("enforces unique UTR payment idempotency and settles invoice when fully paid", async () => {
    (verifyPlatformAdminAccess as jest.Mock).mockResolvedValue({
      authorized: true,
      userId: "admin_1",
    });

    // Duplicate UTR blocked cleanly
    const dupTx = {
      $queryRaw: jest.fn(async () => []),
      batchBuyCommissionInvoice: {
        findUnique: jest.fn(async () => ({
          id: "inv_1",
          invoiceNumber: "AF-BB-202611-0001",
          status: "ISSUED",
          totalPayableAmount: new Prisma.Decimal("3823.20"),
          amountPaid: new Prisma.Decimal("0.00"),
        })),
      },
      commissionPaymentRecord: {
        findUnique: jest.fn(async () => ({ id: "pay_existing" })),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(dupTx));

    const dupRes = await recordCommissionPaymentAction({
      invoiceId: "inv_1",
      amount: 3823.2,
      paymentMode: "NEFT",
      utrOrReference: "UTR-DUP-001",
    });
    expect(dupRes.success).toBe(false);
    expect(dupRes.error).toMatch(/already been recorded/i);

    // Full settlement marks invoice PAID and settles entries
    const updateInv = jest.fn(async () => ({}));
    const settleEntries = jest.fn(async () => ({ count: 1 }));
    const okTx = {
      $queryRaw: jest.fn(async () => []),
      batchBuyCommissionInvoice: {
        findUnique: jest.fn(async () => ({
          id: "inv_1",
          invoiceNumber: "AF-BB-202611-0001",
          instituteId: "inst_1",
          status: "ISSUED",
          totalPayableAmount: new Prisma.Decimal("3823.20"),
          amountPaid: new Prisma.Decimal("0.00"),
        })),
        update: updateInv,
      },
      commissionPaymentRecord: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: "pay_1" })),
      },
      commissionLedgerEntry: {
        updateMany: settleEntries,
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(okTx));

    const okRes = await recordCommissionPaymentAction({
      invoiceId: "inv_1",
      amount: 3823.2,
      paymentMode: "NEFT",
      utrOrReference: "UTR-UNIQUE-999",
    });
    expect(okRes.success).toBe(true);
    expect("status" in okRes && okRes.status).toBe("PAID");
    expect(settleEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "SETTLED" },
      })
    );
  });
});
