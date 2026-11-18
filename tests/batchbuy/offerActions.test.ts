import {
  saveCohortOfferAction,
  publishDraftCohortOfferAction,
  withdrawCohortOfferAction,
  requestGuardianConsentOtpAction,
  verifyGuardianConsentOtpAction,
  respondToCohortOfferAction,
} from "../../lib/batchbuy/offerActions";
import { verifyInstituteManagerAccess } from "../../lib/batchbuy/slabActions";
import { auth } from "../../lib/auth/auth";
import { prisma } from "../../lib/prisma";
import { Prisma } from "../../app/generated/prisma/client";
import { sendWhatsAppMessage } from "../../lib/notifications/whatsapp";
import { createGuardianConsentChallenge } from "../../lib/batchbuy/voucherCrypto";
import { checkRateLimit } from "../../lib/rate-limit";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("../../lib/auth/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("../../lib/batchbuy/slabActions", () => ({
  verifyInstituteManagerAccess: jest.fn(),
}));

jest.mock("../../lib/batchbuy/redemptionAuth", () => ({
  writeBatchBuyAuditLogTx: jest.fn(async () => ({ id: "audit_offer_1" })),
}));

jest.mock("../../lib/rate-limit", () => ({
  checkRateLimit: jest.fn(async () => ({
    success: true,
  })),
}));

jest.mock("../../lib/notifications/notify", () => ({
  notifyUser: jest.fn(async () => null),
}));

jest.mock("../../lib/notifications/whatsapp", () => ({
  sendWhatsAppMessage: jest.fn(async () => ({ success: true, simulated: true })),
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
    groupAdmissionCohort: { findUnique: jest.fn() },
    cohortOffer: { findUnique: jest.fn() },
    groupCohortMember: { findUnique: jest.fn(), update: jest.fn() },
    verification: { findFirst: jest.fn(async () => null), deleteMany: jest.fn(), create: jest.fn() },
    message: { create: jest.fn() },
    conversation: { update: jest.fn() },
  },
}));

const futureOfferIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const futureVoucherIso = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

describe("BatchBuy Slice 3: Offer Management, Guardian Consent & Voucher Issuance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects unauthorized users and SALES_MANAGER from creating/publishing offers", async () => {
    (prisma.groupAdmissionCohort.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "coh_1",
      instituteId: "inst_1",
      batchId: "batch_1",
      cohortCode: "BB-ALLEN-1",
      maxCapacity: 25,
      conversationId: "conv_1",
    });

    (verifyInstituteManagerAccess as jest.Mock).mockResolvedValueOnce({
      authorized: false,
      error: "Access denied. Only Institute Managers or Admins can configure BatchBuy.",
      userId: "sales_user_1",
    });

    const res = await saveCohortOfferAction({
      cohortId: "coh_1",
      title: "JEE 2026 Special Group Offer",
      baseFee: 150000,
      registrationFeeOriginal: 2000,
      waiveRegistration: true,
      discountPercentage: 12,
      includedPerks: ["Test Series"],
      fallbackPolicy: "ABSORB_SHORTFALL",
      minAcceptanceQuorum: 5,
      minAdmissionQuorum: 4,
      offerExpiresAt: futureOfferIso,
      voucherExpiresAt: futureVoucherIso,
      publishImmediately: true,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Access denied/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("enforces immutability of PUBLISHED offers and requires a new version instead", async () => {
    (prisma.groupAdmissionCohort.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "coh_1",
      instituteId: "inst_1",
      batchId: "batch_1",
      cohortCode: "BB-ALLEN-1",
      maxCapacity: 25,
      conversationId: "conv_1",
    });
    (verifyInstituteManagerAccess as jest.Mock).mockResolvedValueOnce({
      authorized: true,
      userId: "mgr_1",
    });

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      groupAdmissionCohort: {
        findUnique: jest.fn(async () => ({
          id: "coh_1",
          cohortCode: "BB-ALLEN-1",
          instituteId: "inst_1",
          batchId: "batch_1",
          status: "OFFER_ACTIVE",
          conversationId: "conv_1",
          institute: { id: "inst_1", name: "Allen Kota" },
          batch: { id: "batch_1", name: "Nurture" },
          members: [],
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_v1",
          cohortId: "coh_1",
          version: 1,
          status: "PUBLISHED",
        })),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await saveCohortOfferAction({
      offerId: "offer_v1",
      cohortId: "coh_1",
      title: "Mutated Published Offer",
      baseFee: 120000,
      registrationFeeOriginal: 0,
      waiveRegistration: true,
      discountPercentage: 25,
      includedPerks: [],
      fallbackPolicy: "ABSORB_SHORTFALL",
      minAcceptanceQuorum: 5,
      minAdmissionQuorum: 4,
      offerExpiresAt: futureOfferIso,
      voucherExpiresAt: futureVoucherIso,
      publishImmediately: false,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/immutable/i);
  });

  test("publishing v2 supersedes v1 atomically and revokes unredeemed v1 vouchers while keeping v1 terms intact", async () => {
    (prisma.cohortOffer.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "offer_v2_draft",
      cohortId: "coh_1",
      instituteId: "inst_1",
    });
    (verifyInstituteManagerAccess as jest.Mock).mockResolvedValueOnce({
      authorized: true,
      userId: "mgr_1",
    });

    const updateManyOffers = jest.fn(async () => ({ count: 1 }));
    const updateManyVouchers = jest.fn(async () => ({ count: 2 }));
    const updateOffer = jest.fn(async ({ data }) => ({
      id: "offer_v2_draft",
      version: 2,
      status: data.status,
      discountPercentage: 15,
      netPayableTuition: 85000,
      minAcceptanceQuorum: 5,
      minAdmissionQuorum: 4,
    }));

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      instituteBatchBuyAgreement: {
        findFirst: jest.fn(async () => ({
          id: "ag_active_1",
          instituteId: "inst_1",
          version: 1,
          rateTier: "PARTNER_2_PCT",
          commissionRatePct: new Prisma.Decimal("2.00"),
          attributionWindowDays: 30,
          holdingPeriodDays: 15,
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_v2_draft",
          cohortId: "coh_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          version: 2,
          status: "DRAFT",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          institute: { name: "Allen Kota" },
          batch: { name: "Nurture" },
          cohort: {
            id: "coh_1",
            cohortCode: "BB-ALLEN-1",
            status: "OFFER_ACTIVE",
            conversationId: "conv_1",
            members: [
              {
                id: "m1",
                userId: "u1",
                stage: "OFFER_ACCEPTED",
                phoneVerified: true,
                profileConfirmed: true,
                explicitIntentAt: new Date(),
              },
            ],
          },
        })),
        updateMany: updateManyOffers,
        update: updateOffer,
      },
      admissionVoucher: {
        count: jest.fn(async () => 0),
        updateMany: updateManyVouchers,
      },
      groupCohortMember: {
        update: jest.fn(async () => ({})),
      },
      groupAdmissionCohort: {
        update: jest.fn(async () => ({})),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await publishDraftCohortOfferAction("offer_v2_draft");

    expect(res.success).toBe(true);
    expect(updateManyOffers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["PUBLISHED", "QUORUM_MET"] } }),
        data: expect.objectContaining({ status: "SUPERSEDED" }),
      })
    );
    expect(updateManyVouchers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["PENDING_QUORUM", "ACTIVE"] } }),
        data: expect.objectContaining({ status: "REVOKED" }),
      })
    );
  });

  test("blocks minor offer acceptance when only parentNotifiedAt is set (requires verified guardian OTP)", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "minor_user_1" },
    });

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUnique: jest.fn(async () => ({
          id: "minor_user_1",
          isActive: true,
          name: "Rohan Sharma",
          phoneVerified: true,
        })),
      },
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_minor_1",
          cohortId: "coh_1",
          userId: "minor_user_1",
          stage: "INTENT_VERIFIED",
          profileConfirmed: true,
          explicitIntentAt: new Date(),
          isMinor: true,
          parentName: "Rajesh Sharma",
          parentPhone: "9876543210",
          parentNotifiedAt: new Date(), // Notification was sent...
          parentConsentVerifiedAt: null, // ...but consent OTP has NOT been verified!
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          version: 1,
          status: "PUBLISHED",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          cohort: {
            id: "coh_1",
            cohortCode: "BB-1",
            status: "OFFER_ACTIVE",
            instituteId: "inst_1",
            batchId: "batch_1",
            conversationId: null,
          },
          institute: { name: "Allen Kota" },
          batch: { name: "Nurture" },
        })),
      },
      groupOfferDecision: {
        findUnique: jest.fn(async () => null),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await respondToCohortOfferAction({
      cohortId: "coh_1",
      offerId: "offer_1",
      decision: "ACCEPTED",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/verified parental\/guardian consent/i);
  });

  test("guardian OTP challenge sets parentNotifiedAt separately and stamps parentConsentVerifiedAt only on valid OTP", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({
      user: { id: "minor_user_1" },
    });

    (prisma.groupCohortMember.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "mem_minor_1",
      stage: "INTENT_VERIFIED",
      isMinor: true,
      parentName: "Rajesh Sharma",
      parentPhone: "9876543210",
      parentNotifiedAt: null,
      user: { id: "minor_user_1", name: "Rohan", isActive: true },
      cohort: {
        cohortCode: "BB-1",
        institute: { name: "Allen" },
        batch: { name: "JEE" },
      },
    });
    (prisma.verification.deleteMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    (prisma.verification.create as jest.Mock).mockResolvedValueOnce({});
    (prisma.groupCohortMember.update as jest.Mock).mockResolvedValueOnce({});

    const otpReq = await requestGuardianConsentOtpAction("coh_1");
    expect(otpReq.success).toBe(true);
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(prisma.groupCohortMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parentNotifiedAt: expect.any(Date) }),
      })
    );

    // Now test verification with real member-bound keyed HMAC OTP hash
    const challenge = createGuardianConsentChallenge("mem_minor_1");
    const memberUpdateSpy = jest.fn(async () => ({}));
    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_minor_1",
          stage: "INTENT_VERIFIED",
          isMinor: true,
          cohort: { cohortCode: "BB-1" },
        })),
        update: memberUpdateSpy,
      },
      verification: {
        findFirst: jest.fn(async () => ({
          id: "ver_1",
          expiresAt: new Date(Date.now() + 600_000),
          value: JSON.stringify({
            salt: challenge.salt,
            otpHash: challenge.otpHash,
            attempts: 0,
          }),
        })),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const verifyRes = await verifyGuardianConsentOtpAction({
      cohortId: "coh_1",
      otp: challenge.otp,
      guardianConfirmationAccepted: true,
    });

    expect(verifyRes.success).toBe(true);
    expect(memberUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentConsentVerifiedAt: expect.any(Date),
          parentConsentMethod: "GUARDIAN_WHATSAPP_OTP",
        }),
      })
    );
  });

  test("enforces minAcceptanceQuorum separately from minAdmissionQuorum and atomically unlocks ACTIVE vouchers when threshold is met", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "u_last" },
    });

    const offerUpdateSpy = jest.fn(async () => ({}));
    const cohortUpdateSpy = jest.fn(async () => ({}));
    const promoteVouchersSpy = jest.fn(async () => ({ count: 2 }));
    const promoteMembersSpy = jest.fn(async () => ({ count: 3 }));
    const createVoucherSpy = jest.fn(async ({ data }) => ({
      ...data,
      id: "v_new_3",
      issuedAt: new Date(),
      revokedAt: null,
      revokeReason: null,
      updatedAt: new Date(),
    }));

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUnique: jest.fn(async () => ({
          id: "u_last",
          isActive: true,
          name: "Priya Verma",
          phoneVerified: true,
        })),
      },
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_3",
          cohortId: "coh_1",
          userId: "u_last",
          stage: "INTENT_VERIFIED",
          profileConfirmed: true,
          explicitIntentAt: new Date(),
          isMinor: false,
          parentConsentVerifiedAt: null,
        })),
        updateMany: promoteMembersSpy,
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          version: 1,
          status: "PUBLISHED",
          baseFee: "100000.00",
          registrationFeeOriginal: "2000.00",
          waiveRegistration: true,
          discountPercentage: "15.00",
          discountAmount: "15000.00",
          netPayableTuition: "85000.00",
          includedPerks: ["Test Series"],
          fallbackPolicy: "ABSORB_SHORTFALL",
          minAcceptanceQuorum: 3, // Acceptance quorum is 3
          minAdmissionQuorum: 2,  // Center admission quorum is tracked separately as 2
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          cohort: {
            id: "coh_1",
            cohortCode: "BB-1",
            status: "OFFER_ACTIVE",
            instituteId: "inst_1",
            batchId: "batch_1",
            conversationId: null,
          },
          institute: { name: "Allen Kota" },
          batch: { name: "Nurture" },
        })),
        update: offerUpdateSpy,
      },
      groupOfferDecision: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: "dec_3" })),
        count: jest.fn(async () => 3), // This student pushes acceptedCount to 3 == minAcceptanceQuorum
        findMany: jest.fn(async () => [
          { cohortMemberId: "mem_1", userId: "u_1" },
          { cohortMemberId: "mem_2", userId: "u_2" },
          { cohortMemberId: "mem_3", userId: "u_last" },
        ]),
      },
      admissionVoucher: {
        create: createVoucherSpy,
        updateMany: promoteVouchersSpy,
      },
      groupAdmissionCohort: {
        update: cohortUpdateSpy,
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await respondToCohortOfferAction({
      cohortId: "coh_1",
      offerId: "offer_1",
      decision: "ACCEPTED",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.quorumJustMet).toBe(true);
      expect(res.voucher?.status).toBe("ACTIVE");
      expect(res.voucher?.isRedeemable).toBe(true);
      expect(res.voucher?.minAcceptanceQuorum).toBe(3);
      expect(res.voucher?.minAdmissionQuorum).toBe(2);
    }

    // Locks user -> member -> offer in consistent deadlock-free order
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(offerUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "QUORUM_MET" }),
      })
    );
    expect(cohortUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ADMISSION_OPEN" }),
      })
    );
    expect(promoteVouchersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offerId: "offer_1", status: "PENDING_QUORUM" },
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  test("prevents duplicate voucher issuance on simultaneous replay click (idempotent response)", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "u_1" },
    });

    const createVoucherSpy = jest.fn();
    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUnique: jest.fn(async () => ({
          id: "u_1",
          isActive: true,
          name: "Ankit",
          phoneVerified: true,
        })),
      },
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_1",
          cohortId: "coh_1",
          userId: "u_1",
          stage: "OFFER_ACCEPTED",
          profileConfirmed: true,
          explicitIntentAt: new Date(),
          isMinor: false,
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          version: 1,
          status: "PUBLISHED",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          cohort: { id: "coh_1", cohortCode: "BB-1", status: "OFFER_ACTIVE" },
          institute: { name: "Allen" },
          batch: { name: "Nurture" },
        })),
      },
      groupOfferDecision: {
        findUnique: jest.fn(async () => ({
          id: "dec_1",
          decision: "ACCEPTED",
        })),
        count: jest.fn(async () => 1),
      },
      admissionVoucher: {
        findUnique: jest.fn(async () => ({
          id: "v_1",
          voucherCode: "AFBB-9K4M-P7Q2-X8R5",
          securityNonce: "abcd".repeat(12),
          offerId: "offer_1",
          offerVersion: 1,
          cohortId: "coh_1",
          cohortMemberId: "mem_1",
          userId: "u_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          status: "PENDING_QUORUM",
          baseFee: "100000.00",
          registrationFeeOriginal: "0.00",
          waiveRegistration: true,
          discountPercentage: "10.00",
          discountAmount: "10000.00",
          netPayableTuition: "90000.00",
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          minAcceptanceQuorumSnapshot: 5,
          minAdmissionQuorumSnapshot: 4,
          studentNameSnapshot: "Ankit",
          instituteNameSnapshot: "Allen",
          batchNameSnapshot: "Nurture",
          issuedAt: new Date(),
          activatedAt: null,
          expiresAt: new Date(futureVoucherIso),
          revokedAt: null,
          revokeReason: null,
        })),
        create: createVoucherSpy,
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await respondToCohortOfferAction({
      cohortId: "coh_1",
      offerId: "offer_1",
      decision: "ACCEPTED",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.alreadyDecided).toBe(true);
      expect(res.voucher?.voucherCode).toBe("AFBB-9K4M-P7Q2-X8R5");
    }
    expect(createVoucherSpy).not.toHaveBeenCalled();
  });

  test("persists EXPIRED status cleanly if offer deadline has passed during response", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "u_1" },
    });

    const offerUpdateManySpy = jest.fn(async () => ({ count: 1 }));
    const voucherExpireSpy = jest.fn(async () => ({ count: 2 }));
    const pastOfferDate = new Date(Date.now() - 60_000);

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUnique: jest.fn(async () => ({
          id: "u_1",
          isActive: true,
          name: "Ankit",
          phoneVerified: true,
        })),
      },
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_1",
          cohortId: "coh_1",
          userId: "u_1",
          stage: "INTENT_VERIFIED",
          profileConfirmed: true,
          explicitIntentAt: new Date(),
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          version: 1,
          status: "PUBLISHED",
          offerExpiresAt: pastOfferDate,
          voucherExpiresAt: new Date(futureVoucherIso),
          cohort: { id: "coh_1", cohortCode: "BB-1", status: "OFFER_ACTIVE" },
          institute: { name: "Allen" },
          batch: { name: "Nurture" },
        })),
        updateMany: offerUpdateManySpy,
      },
      admissionVoucher: {
        updateMany: voucherExpireSpy,
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await respondToCohortOfferAction({
      cohortId: "coh_1",
      offerId: "offer_1",
      decision: "ACCEPTED",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expired/i);
    expect(offerUpdateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "offer_1", status: "PUBLISHED" },
        data: { status: "EXPIRED" },
      })
    );
    expect(voucherExpireSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offerId: "offer_1", status: "PENDING_QUORUM" },
        data: expect.objectContaining({ status: "EXPIRED" }),
      })
    );
  });

  test("handles concurrent double-accept via P2034 serialization conflict and P2002 unique guard cleanly", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({
      user: { id: "u_concurrent" },
    });

    (prisma.$transaction as jest.Mock)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("could not serialize access", {
          code: "P2034",
          clientVersion: "7.8.0",
        })
      )
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on offerId_userId", {
          code: "P2002",
          clientVersion: "7.8.0",
        })
      );

    const [conflictRes, uniqueRes] = await Promise.all([
      respondToCohortOfferAction({
        cohortId: "coh_1",
        offerId: "offer_1",
        decision: "ACCEPTED",
      }),
      respondToCohortOfferAction({
        cohortId: "coh_1",
        offerId: "offer_1",
        decision: "ACCEPTED",
      }),
    ]);

    expect(conflictRes.success).toBe(false);
    expect(conflictRes.error).toMatch(/Concurrent offer response/i);
    expect(uniqueRes.success).toBe(false);
    expect(uniqueRes.error).toMatch(/Duplicate voucher issuance was prevented/i);
  });

  test("rejects unverified explicit intent even when phoneVerified is true", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "u_no_intent" },
    });

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        findUnique: jest.fn(async () => ({
          id: "u_no_intent",
          isActive: true,
          name: "Meera",
          phoneVerified: true,
        })),
      },
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_no_intent",
          cohortId: "coh_1",
          userId: "u_no_intent",
          stage: "INTERESTED",
          profileConfirmed: false,
          explicitIntentAt: null,
          isMinor: false,
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          version: 1,
          status: "PUBLISHED",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          cohort: { id: "coh_1", cohortCode: "BB-1", status: "OFFER_ACTIVE" },
          institute: { name: "Allen" },
          batch: { name: "Nurture" },
        })),
      },
      groupOfferDecision: {
        findUnique: jest.fn(async () => null),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await respondToCohortOfferAction({
      cohortId: "coh_1",
      offerId: "offer_1",
      decision: "ACCEPTED",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/explicit course & admission intent/i);
  });

  test("blocks offer supersession and withdrawal whenever any voucher is REDEEMED", async () => {
    (prisma.cohortOffer.findUnique as jest.Mock).mockResolvedValue({
      id: "offer_1",
      cohortId: "coh_1",
      instituteId: "inst_1",
    });
    (verifyInstituteManagerAccess as jest.Mock).mockResolvedValue({
      authorized: true,
      userId: "mgr_1",
    });

    const withdrawTx = {
      $queryRaw: jest.fn(async () => []),
      cohortOffer: {
        findUnique: jest.fn(async () => ({
          id: "offer_1",
          cohortId: "coh_1",
          version: 1,
          status: "QUORUM_MET",
          cohort: { status: "ADMISSION_OPEN", members: [] },
        })),
      },
      admissionVoucher: {
        count: jest.fn(async () => 1),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(withdrawTx));

    const withdrawRes = await withdrawCohortOfferAction("offer_1");
    expect(withdrawRes.success).toBe(false);
    expect(withdrawRes.error).toMatch(/already.*redeemed|after vouchers have been redeemed/i);

    const publishTx = {
      $queryRaw: jest.fn(async () => []),
      instituteBatchBuyAgreement: {
        findFirst: jest.fn(async () => ({
          id: "ag_active_1",
          instituteId: "inst_1",
          version: 1,
          rateTier: "STANDARD_3_PCT",
          commissionRatePct: new Prisma.Decimal("3.00"),
          attributionWindowDays: 30,
          holdingPeriodDays: 15,
        })),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_2",
          cohortId: "coh_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          version: 2,
          status: "DRAFT",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          institute: { name: "Allen" },
          batch: { name: "Nurture" },
          cohort: { id: "coh_1", cohortCode: "BB-1", status: "ADMISSION_OPEN", conversationId: "c1", members: [] },
        })),
      },
      admissionVoucher: {
        count: jest.fn(async () => 1),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(publishTx));

    const pubRes = await publishDraftCohortOfferAction("offer_2");
    expect(pubRes.success).toBe(false);
    expect(pubRes.error).toMatch(/redeemed/i);
  });

  test("enforces Guardian OTP hourly cap, IP rate-limit, and verified consent replay prevention", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({
      user: { id: "minor_u_cap" },
    });

    // 1. Replay prevention when consent is already verified
    (prisma.groupCohortMember.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "mem_verified",
      stage: "INTENT_VERIFIED",
      isMinor: true,
      parentName: "Rakesh",
      parentPhone: "9876543210",
      parentNotifiedAt: new Date(Date.now() - 120_000),
      parentConsentVerifiedAt: new Date(),
      user: { id: "minor_u_cap", name: "Aman", isActive: true },
      cohort: { cohortCode: "BB-1", institute: { name: "Allen" }, batch: { name: "JEE" } },
    });
    const alreadyVerifiedReq = await requestGuardianConsentOtpAction("coh_1");
    expect(alreadyVerifiedReq.success).toBe(false);
    expect(alreadyVerifiedReq.error).toMatch(/already been verified/i);

    // 2. Hourly 5-OTP cap
    (prisma.groupCohortMember.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "mem_cap",
      stage: "INTENT_VERIFIED",
      isMinor: true,
      parentName: "Rakesh",
      parentPhone: "9876543210",
      parentNotifiedAt: new Date(Date.now() - 120_000),
      parentConsentVerifiedAt: null,
      user: { id: "minor_u_cap", name: "Aman", isActive: true },
      cohort: { cohortCode: "BB-1", institute: { name: "Allen" }, batch: { name: "JEE" } },
    });
    (prisma.verification.findFirst as jest.Mock).mockResolvedValueOnce({
      value: JSON.stringify({
        salt: "s",
        otpHash: "h",
        attempts: 0,
        sendCount: 5,
        windowStartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    });
    const capRes = await requestGuardianConsentOtpAction("coh_1");
    expect(capRes.success).toBe(false);
    expect(capRes.error).toMatch(/5 requests\/hour/i);

    // 3. Rate limit check fail-closed
    (checkRateLimit as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    const rateLimitedRes = await requestGuardianConsentOtpAction("coh_1");
    expect(rateLimitedRes.success).toBe(false);
    expect(rateLimitedRes.error).toMatch(/too many guardian otp requests/i);

    // 4. Verify replay blocked in tx once parentConsentVerifiedAt is set
    const replayTx = {
      $queryRaw: jest.fn(async () => []),
      groupCohortMember: {
        findUnique: jest.fn(async () => ({
          id: "mem_verified",
          stage: "INTENT_VERIFIED",
          isMinor: true,
          parentConsentVerifiedAt: new Date(),
          cohort: { cohortCode: "BB-1" },
        })),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(replayTx));
    const verifyReplayRes = await verifyGuardianConsentOtpAction({
      cohortId: "coh_1",
      otp: "123456",
      guardianConfirmationAccepted: true,
    });
    expect(verifyReplayRes.success).toBe(false);
    expect(verifyReplayRes.error).toMatch(/replay is not permitted/i);
  });

  test("blocks publishing an offer if the institute lacks an active signed commercial agreement", async () => {
    (prisma.cohortOffer.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "offer_no_ag",
      cohortId: "coh_1",
      instituteId: "inst_no_ag",
    });
    (verifyInstituteManagerAccess as jest.Mock).mockResolvedValueOnce({
      authorized: true,
      userId: "mgr_1",
    });

    const mockTx = {
      $queryRaw: jest.fn(async () => []),
      instituteBatchBuyAgreement: {
        findFirst: jest.fn(async () => null),
      },
      cohortOffer: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({
          id: "offer_no_ag",
          cohortId: "coh_1",
          instituteId: "inst_no_ag",
          batchId: "batch_1",
          version: 1,
          status: "DRAFT",
          offerExpiresAt: new Date(futureOfferIso),
          voucherExpiresAt: new Date(futureVoucherIso),
          institute: { name: "Allen" },
          batch: { name: "Nurture" },
          cohort: {
            id: "coh_1",
            cohortCode: "BB-1",
            status: "OFFER_PENDING",
            conversationId: "conv_1",
            members: [],
          },
        })),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => cb(mockTx));

    const res = await publishDraftCohortOfferAction("offer_no_ag");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/active, signed BatchBuy Commercial Agreement/i);
  });
});
