import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { auth } from "../../lib/auth/auth";
import { Prisma } from "../../app/generated/prisma/client";
import {
  saveInstituteBatchBuyAgreementCore,
  acceptAndActivateAgreementCore,
} from "../../lib/batchbuy/core/agreementCore";
import {
  reviewFlaggedAttributionCore,
  matureEligibleCommissionsCore,
  generateCommissionInvoiceCore,
  issueCommissionInvoiceCore,
  recordCommissionPaymentCore,
  settleCreditNoteRefundCore,
} from "../../lib/batchbuy/core/commissionCore";
import {
  redeemBatchBuyVoucherCore,
  settleExpiredOfferAdmissionQuorumCore,
  respondToFallbackAdjustmentCore,
  cancelOrRefundBatchBuyAdmissionCore,
} from "../../lib/batchbuy/core/redemptionCore";
import {
  createAdmissionFromPipelineTx,
  detectAndFlagPotentialBypassTx,
} from "../../lib/instituteSalesManager/admissionPipeline";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
  verifyVoucherQrPresentation,
  createGuardianConsentChallenge,
  hashGuardianOtp,
  verifyGuardianOtpHash,
} from "../../lib/batchbuy/voucherCrypto";
import { validateSlabRangesAndTiers } from "../../lib/batchbuy/slabValidation";
import { SaveCohortOfferSchema } from "../../lib/batchbuy/offerValidation";
import { writeBatchBuyAuditLogTx } from "../../lib/batchbuy/redemptionAuth";

const STAGING_URL = process.env.STAGING_BASE_URL || "http://localhost:3000";
const RUN_TAG = `__stg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const TEST_PASS = "StagingTest@2026!";

type HttpAuthClient = {
  cookie: string;
  get: (path: string) => Promise<{ status: number; body: string; location: string | null }>;
  postJson: (path: string, payload: unknown) => Promise<{ status: number; json: any; body: string }>;
};

async function createAndSignInUser(opts: {
  name: string;
  email: string;
  username: string;
  phone: string;
  role: "ADMIN" | "USER" | "SALES_MANAGER";
  cleanupUserIds: string[];
}): Promise<{ user: { id: string; name: string | null; email: string; phone: string | null; role: string }; client: HttpAuthClient }> {
  await auth.api.signUpEmail({
    body: {
      email: opts.email,
      password: TEST_PASS,
      name: opts.name,
    },
  });

  const created = await prisma.user.findUniqueOrThrow({ where: { email: opts.email } });
  opts.cleanupUserIds.push(created.id);

  const updated = await prisma.user.update({
    where: { id: created.id },
    data: {
      emailVerified: true,
      role: opts.role,
      username: opts.username,
      phone: opts.phone,
      phoneVerified: true,
      isActive: true,
      onboardingCompleted: true,
    },
  });

  const signInRes = await auth.api.signInEmail({
    body: { email: opts.email, password: TEST_PASS },
    asResponse: true,
  });
  assert.ok(signInRes.ok, `Better Auth sign-in failed for ${opts.email}: ${signInRes.status}`);

  const setCookies = signInRes.headers.getSetCookie?.() || [];
  const rawCookieHeader =
    setCookies.length > 0
      ? setCookies.map((c) => c.split(";")[0]).join("; ")
      : (signInRes.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(rawCookieHeader.includes("better-auth"), `Missing session cookie for ${opts.email}`);

  const client: HttpAuthClient = {
    cookie: rawCookieHeader,
    async get(path: string) {
      const res = await fetch(`${STAGING_URL}${path}`, {
        method: "GET",
        headers: { Cookie: rawCookieHeader },
        redirect: "manual",
      });
      return {
        status: res.status,
        body: await res.text(),
        location: res.headers.get("location"),
      };
    },
    async postJson(path: string, payload: unknown) {
      const res = await fetch(`${STAGING_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: rawCookieHeader,
          Origin: STAGING_URL,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
      return { status: res.status, json, body };
    },
  };

  return {
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      role: updated.role,
    },
    client,
  };
}

async function main() {
  console.log(`[BatchBuy Staging Acceptance] Starting ${RUN_TAG} against ${STAGING_URL}...`);
  const health = await fetch(`${STAGING_URL}/batchbuy`);
  assert.equal(health.status, 200, `Expected staging /batchbuy HTTP 200, got ${health.status}`);

  const cleanup = {
    userIds: [] as string[],
    instituteIds: [] as string[],
    batchIds: [] as string[],
    cohortIds: [] as string[],
    admissionIds: [] as string[],
    enquiryIds: [] as string[],
    conversationIds: [] as string[],
    invoiceIds: [] as string[],
  };

  try {
    const now = new Date();
    const past16Days = new Date(now.getTime() - 16 * 86_400_000);
    const futureExpiry = new Date(now.getTime() + 14 * 86_400_000);

    const city = await prisma.city.findFirstOrThrow();

    // Seed Personas via Real Better Auth Sign-Up + Sign-In
    const admin = await createAndSignInUser({
      name: "Staging Admin",
      email: `${RUN_TAG}_admin@academyfind.test`,
      username: `${RUN_TAG}_admin`,
      phone: "9900110001",
      role: "ADMIN",
      cleanupUserIds: cleanup.userIds,
    });
    const manager = await createAndSignInUser({
      name: "Staging Manager",
      email: `${RUN_TAG}_mgr@academyfind.test`,
      username: `${RUN_TAG}_mgr`,
      phone: "9900110002",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const salesMgr = await createAndSignInUser({
      name: "Staging SalesMgr",
      email: `${RUN_TAG}_sm@academyfind.test`,
      username: `${RUN_TAG}_sm`,
      phone: "9900110003",
      role: "SALES_MANAGER",
      cleanupUserIds: cleanup.userIds,
    });
    const ism = await createAndSignInUser({
      name: "Staging ISM",
      email: `${RUN_TAG}_ism@academyfind.test`,
      username: `${RUN_TAG}_ism`,
      phone: "9900110004",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const otherMgr = await createAndSignInUser({
      name: "Other Institute Manager",
      email: `${RUN_TAG}_other_mgr@academyfind.test`,
      username: `${RUN_TAG}_other_mgr`,
      phone: "9900110005",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });

    const students = await Promise.all(
      ["A", "B", "C", "D", "E", "F", "G"].map((label, i) =>
        createAndSignInUser({
          name: `Student ${label}`,
          email: `${RUN_TAG}_stu_${label.toLowerCase()}@academyfind.test`,
          username: `${RUN_TAG}_stu_${label.toLowerCase()}`,
          phone: `990022000${i + 1}`,
          role: "USER",
          cleanupUserIds: cleanup.userIds,
        })
      )
    );
    const [stuA, stuB, stuC, stuD, stuE, stuF, stuG] = students;

    // Seed 2 Institutes + Batches + Role Assignments
    const institute = await prisma.institute.create({
      data: {
        name: `Staging Institute ${RUN_TAG}`,
        slug: `${RUN_TAG}-inst`,
        address: "101 Staging Tower, Kota",
        cityId: city.id,
        isVerified: true,
      },
    });
    cleanup.instituteIds.push(institute.id);

    const otherInstitute = await prisma.institute.create({
      data: {
        name: `Other Institute ${RUN_TAG}`,
        slug: `${RUN_TAG}-other-inst`,
        address: "202 Other Tower, Delhi",
        cityId: city.id,
        isVerified: true,
      },
    });
    cleanup.instituteIds.push(otherInstitute.id);

    await prisma.instituteManager.createMany({
      data: [
        { userId: manager.user.id, instituteId: institute.id },
        { userId: otherMgr.user.id, instituteId: otherInstitute.id },
      ],
    });

    await prisma.instituteMembership.createMany({
      data: [
        {
          userId: manager.user.id,
          instituteId: institute.id,
          role: "MANAGER",
          status: "ACTIVE",
          isActive: true,
        },
        {
          userId: salesMgr.user.id,
          instituteId: institute.id,
          role: "SALES_MANAGER",
          status: "ACTIVE",
          isActive: true,
        },
      ],
    });
    await prisma.instituteSalesManagerAssignment.create({
      data: {
        userId: ism.user.id,
        instituteId: institute.id,
        assignedById: manager.user.id,
        isActive: true,
      },
    });

    const batch = await prisma.instituteBatch.create({
      data: {
        instituteId: institute.id,
        slug: `${RUN_TAG}-batch`,
        name: "JEE Target Staging Batch",
        courseName: "JEE",
        fee: 120000,
        originalFee: 120000,
      },
    });
    cleanup.batchIds.push(batch.id);

    const mgrAuth = {
      userId: manager.user.id,
      userName: manager.user.name || "Manager",
      actorRole: "MANAGER",
      isIsmRole: false,
    };
    const ismAuth = {
      userId: ism.user.id,
      userName: ism.user.name || "ISM",
      actorRole: "INSTITUTE_SALES_MANAGER",
      isIsmRole: true,
    };

    // =========================================================================
    // TEST 1 — Institute onboarding
    // =========================================================================
    const ag1Save = await saveInstituteBatchBuyAgreementCore(
      {
        instituteId: institute.id,
        rateTier: "PARTNER_2_PCT",
        gstRatePct: 18,
        gstTreatmentNote: "Initial 2% draft before v2",
        sacCode: "998399",
        sacValidatedByCa: true,
        caValidatorName: "CA Staging",
        caMembershipNumber: "145920",
        caValidationNote: "Verified SAC 998399",
        attributionWindowDays: 30,
        holdingPeriodDays: 15,
        paymentDueDays: 15,
        cancellationClawbackPolicy: "15-day commercial cooling-off hold.",
        effectiveFrom: past16Days.toISOString(),
        effectiveTo: null,
        activateImmediately: true,
        acceptedRepresentativeName: "Staging Director",
        acceptedDesignation: "Director",
      },
      admin.user.id
    );
    assert.equal(ag1Save.success, true, `ag1Save failed: ${(ag1Save as any).error}`);

    const ag2Save = await saveInstituteBatchBuyAgreementCore(
      {
        instituteId: institute.id,
        rateTier: "STANDARD_3_PCT",
        gstRatePct: 18,
        gstTreatmentNote: "3% standard agreement CA-validated under SAC 998399.",
        sacCode: "998399",
        sacValidatedByCa: true,
        caValidatorName: "CA Staging",
        caMembershipNumber: "145920",
        caValidationNote: "Verified SAC 998399",
        attributionWindowDays: 30,
        holdingPeriodDays: 15,
        paymentDueDays: 15,
        cancellationClawbackPolicy: "15-day cooling-off; post-hold reversals issue GST credit notes.",
        effectiveFrom: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
        effectiveTo: null,
        activateImmediately: false,
      },
      admin.user.id
    );
    assert.equal(ag2Save.success, true);

    const ag2Activate = await acceptAndActivateAgreementCore(
      {
        agreementId: ag2Save.agreementId,
        acceptedRepresentativeName: "Staging Director",
        acceptedDesignation: "Director",
      },
      manager.user.id
    );
    assert.equal(ag2Activate.success, true);

    const [ag1Row, ag2Row, adminPageRes, smAdminPageRes] = await Promise.all([
      prisma.instituteBatchBuyAgreement.findUniqueOrThrow({ where: { id: ag1Save.agreementId } }),
      prisma.instituteBatchBuyAgreement.findUniqueOrThrow({ where: { id: ag2Save.agreementId } }),
      admin.client.get("/af-ass-manage/batchbuy"),
      salesMgr.client.get("/af-ass-manage/batchbuy"),
    ]);
    assert.equal(ag1Row.status, "SUPERSEDED");
    assert.equal(ag2Row.status, "ACTIVE");
    assert.equal(Number(ag2Row.commissionRatePct), 3);
    assert.equal(ag2Row.holdingPeriodDays, 15);
    assert.equal(adminPageRes.status, 200);
    assert.ok(adminPageRes.body.includes("BatchBuy Reconciliation"));
    assert.ok(
      smAdminPageRes.status !== 200 || smAdminPageRes.body.includes("Access Denied"),
      `Expected SALES_MANAGER to be denied /af-ass-manage/batchbuy, got status=${smAdminPageRes.status}`
    );
    assert.equal(smAdminPageRes.body.includes("BatchBuy Reconciliation"), false);
    console.log("  [PASS] TEST 1 — Institute onboarding (Admin agreement v1->v2 superseded, 3% + 15d hold, SALES_MANAGER blocked).");

    // =========================================================================
    // TEST 2 — Slabs and cohort creation + chat privacy + phone protection
    // =========================================================================
    validateSlabRangesAndTiers([
      {
        minStudents: 2,
        maxStudents: 3,
        discountPercentage: 8,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ]);
    validateSlabRangesAndTiers([
      {
        minStudents: 2,
        maxStudents: 3,
        discountPercentage: 10,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        isActive: true,
      },
      {
        minStudents: 4,
        maxStudents: 6,
        discountPercentage: 15,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        isActive: true,
      },
    ]);

    await prisma.groupDiscountSlab.createMany({
      data: [
        {
          instituteId: institute.id,
          batchId: null,
          minStudents: 2,
          maxStudents: 3,
          discountPercentage: new Prisma.Decimal("8.00"),
          fallbackPolicy: "ABSORB_SHORTFALL",
          isActive: true,
          createdById: manager.user.id,
        },
        {
          instituteId: institute.id,
          batchId: batch.id,
          minStudents: 2,
          maxStudents: 3,
          discountPercentage: new Prisma.Decimal("10.00"),
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          isActive: true,
          createdById: manager.user.id,
        },
        {
          instituteId: institute.id,
          batchId: batch.id,
          minStudents: 4,
          maxStudents: 6,
          discountPercentage: new Prisma.Decimal("15.00"),
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          isActive: true,
          createdById: manager.user.id,
        },
      ],
    });
    await prisma.$transaction(async (tx) => {
      await writeBatchBuyAuditLogTx(tx, {
        instituteId: institute.id,
        actorUserId: manager.user.id,
        actorRole: "MANAGER",
        action: "SLABS_SAVED",
        entityType: "GroupDiscountSlab",
        entityId: batch.id,
        reason: "Saved institute-wide and batch-specific slabs.",
      });
    });

    const conv = await prisma.conversation.create({
      data: {
        type: "GROUP",
        title: `Staging Cohort Chat ${RUN_TAG}`,
        instituteId: institute.id,
        batchId: batch.id,
        participants: {
          create: [
            { userId: stuA.user.id, role: "ADMIN", status: "ACTIVE" },
            { userId: stuB.user.id, role: "MEMBER", status: "ACTIVE" },
            { userId: stuC.user.id, role: "MEMBER", status: "ACTIVE" },
          ],
        },
      },
    });
    cleanup.conversationIds.push(conv.id);

    const cohort = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-STG-${RUN_TAG.slice(-5).toUpperCase()}`,
        title: "Staging JEE Cohort",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        minRequired: 2,
        targetSize: 3,
        maxCapacity: 3,
        status: "FORMING",
        formingExpiresAt: futureExpiry,
        createdById: stuA.user.id,
        conversationId: conv.id,
      },
    });
    cleanup.cohortIds.push(cohort.id);

    await prisma.groupCohortMember.createMany({
      data: [
        {
          cohortId: cohort.id,
          userId: stuA.user.id,
          stage: "INTENT_VERIFIED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
        {
          cohortId: cohort.id,
          userId: stuB.user.id,
          stage: "INTENT_VERIFIED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
        {
          cohortId: cohort.id,
          userId: stuC.user.id,
          stage: "INTENT_VERIFIED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
      ],
    });

    let dupMemberRejected = false;
    try {
      await prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: stuA.user.id,
          stage: "INTENT_VERIFIED",
        },
      });
    } catch {
      dupMemberRejected = true;
    }
    assert.equal(dupMemberRejected, true);

    const activeMembers = await prisma.groupCohortMember.count({
      where: { cohortId: cohort.id, stage: { notIn: ["DROPPED", "OFFER_DECLINED"] } },
    });
    assert.equal(activeMembers, cohort.maxCapacity);

    const [stuAConvRes, mgrConvRes, cohortPageRes] = await Promise.all([
      stuA.client.get(`/api/v2/conversations/${conv.id}`),
      manager.client.get(`/api/v2/conversations/${conv.id}`),
      stuA.client.get(`/batchbuy/${cohort.cohortCode}`),
    ]);
    assert.equal(stuAConvRes.status, 200);
    assert.equal(stuAConvRes.body.includes(stuB.user.phone!), false, "Phone leaked in conversation payload");
    assert.ok(
      [403, 404].includes(mgrConvRes.status),
      `Expected 403 or 404 for manager snooping cohort chat, got ${mgrConvRes.status}`
    );
    assert.equal(cohortPageRes.status, 200);
    console.log("  [PASS] TEST 2 — Slabs, cohort creation, duplicate/capacity guards, chat privacy (403 for manager) & phone protection.");

    // =========================================================================
    // TEST 3 — Offer and acceptance + Guardian OTP for minor + No duplicate vouchers
    // =========================================================================
    const offerParsed = SaveCohortOfferSchema.safeParse({
      cohortId: cohort.id,
      title: "Staging Offer V1 (Absorb)",
      baseFee: 120000,
      registrationFeeOriginal: 5000,
      waiveRegistration: true,
      discountPercentage: 15,
      includedPerks: ["Test Series"],
      fallbackPolicy: "ABSORB_SHORTFALL",
      minAcceptanceQuorum: 2,
      minAdmissionQuorum: 2,
      offerExpiresAt: futureExpiry.toISOString(),
      voucherExpiresAt: futureExpiry.toISOString(),
    });
    assert.equal(offerParsed.success, true);

    const offer1 = await prisma.cohortOffer.create({
      data: {
        cohortId: cohort.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 1,
        status: "QUORUM_MET",
        title: "Staging Offer V1 (Absorb)",
        baseFee: new Prisma.Decimal("120000.00"),
        registrationFeeOriginal: new Prisma.Decimal("5000.00"),
        waiveRegistration: true,
        discountPercentage: new Prisma.Decimal("15.00"),
        discountAmount: new Prisma.Decimal("18000.00"),
        netPayableTuition: new Prisma.Decimal("102000.00"),
        includedPerks: ["Test Series"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        minAcceptanceQuorum: 2,
        minAdmissionQuorum: 2,
        offerExpiresAt: futureExpiry,
        voucherExpiresAt: futureExpiry,
        publishedAt: past16Days,
        quorumMetAt: past16Days,
        createdById: manager.user.id,
        commissionAgreementId: ag2Row.id,
        commissionRatePctSnapshot: ag2Row.commissionRatePct,
        commissionTierSnapshot: ag2Row.rateTier,
        attributionWindowDaysSnapshot: ag2Row.attributionWindowDays,
        holdingPeriodDaysSnapshot: ag2Row.holdingPeriodDays,
      },
    });

    const memRows = await prisma.groupCohortMember.findMany({ where: { cohortId: cohort.id } });
    const memMap = new Map(memRows.map((m) => [m.userId, m.id]));
    const memCId = memMap.get(stuC.user.id)!;

    // Guardian OTP verification for minor Student C
    const minorOtp = createGuardianConsentChallenge(memCId);
    assert.equal(verifyGuardianOtpHash(minorOtp.salt, minorOtp.otp, minorOtp.otpHash, memCId), true);
    assert.equal(verifyGuardianOtpHash(minorOtp.salt, "000000", minorOtp.otpHash, memCId), false);

    await prisma.groupCohortMember.update({
      where: { id: memCId },
      data: {
        isMinor: true,
        parentName: "Parent C",
        parentPhone: "9811112222",
        parentConsentVerifiedAt: new Date(),
      },
    });

    const seedVoucherForMember = async (
      o: typeof offer1,
      stu: typeof stuA.user,
      memberId: string,
      cId: string
    ) => {
      const dec = await prisma.groupOfferDecision.create({
        data: {
          offerId: o.id,
          cohortId: cId,
          cohortMemberId: memberId,
          userId: stu.id,
          decision: "ACCEPTED",
          decidedAt: past16Days,
          revalidatedIntentAt: past16Days,
        },
      });
      const art = generateVoucherArtifacts({
        offerId: o.id,
        offerVersion: o.version,
        cohortId: cId,
        cohortMemberId: memberId,
        userId: stu.id,
        instituteId: institute.id,
        batchId: batch.id,
      });
      const voucher = await prisma.admissionVoucher.create({
        data: {
          voucherCode: art.voucherCode,
          tokenHash: art.tokenHash,
          securityNonce: art.securityNonce,
          offerId: o.id,
          offerVersion: o.version,
          decisionId: dec.id,
          cohortId: cId,
          cohortMemberId: memberId,
          userId: stu.id,
          instituteId: institute.id,
          batchId: batch.id,
          status: "ACTIVE",
          baseFee: o.baseFee,
          registrationFeeOriginal: o.registrationFeeOriginal,
          waiveRegistration: o.waiveRegistration,
          discountPercentage: o.discountPercentage,
          discountAmount: o.discountAmount,
          netPayableTuition: o.netPayableTuition,
          includedPerks: [],
          fallbackPolicy: o.fallbackPolicy,
          minAcceptanceQuorumSnapshot: o.minAcceptanceQuorum,
          minAdmissionQuorumSnapshot: o.minAdmissionQuorum,
          studentNameSnapshot: stu.name || "Student",
          instituteNameSnapshot: institute.name,
          batchNameSnapshot: batch.name,
          activatedAt: past16Days,
          expiresAt: o.voucherExpiresAt,
        },
      });
      const qr = computeVoucherQrPayload({
        voucherCode: art.voucherCode,
        securityNonce: art.securityNonce,
        offerId: o.id,
        offerVersion: o.version,
        cohortId: cId,
        cohortMemberId: memberId,
        userId: stu.id,
        instituteId: institute.id,
        batchId: batch.id,
        expiresAtIso: o.voucherExpiresAt.toISOString(),
      });
      return { voucher, qrPayload: qr.qrPayload };
    };

    // B declines independently
    await prisma.groupOfferDecision.create({
      data: {
        offerId: offer1.id,
        cohortId: cohort.id,
        cohortMemberId: memMap.get(stuB.user.id)!,
        userId: stuB.user.id,
        decision: "DECLINED",
        decidedAt: past16Days,
        revalidatedIntentAt: past16Days,
      },
    });

    const vA = await seedVoucherForMember(offer1, stuA.user, memMap.get(stuA.user.id)!, cohort.id);
    const vC = await seedVoucherForMember(offer1, stuC.user, memCId, cohort.id);

    let dupVoucherRejected = false;
    try {
      await seedVoucherForMember(offer1, stuA.user, memMap.get(stuA.user.id)!, cohort.id);
    } catch {
      dupVoucherRejected = true;
    }
    assert.equal(dupVoucherRejected, true);
    console.log("  [PASS] TEST 3 — Offer published, independent A/B/C decisions, guardian OTP verified, duplicate voucher blocked.");

    // =========================================================================
    // TEST 4 — Counter redemption (ISM, concurrent, wrong institute, existing CRM)
    // =========================================================================
    const ismPageRes = await ism.client.get(`/institute_sales/${institute.id}/${ism.user.id}/batchbuy/redemptions`);
    assert.equal(ismPageRes.status, 200);

    const [race1, race2] = await Promise.all([
      redeemBatchBuyVoucherCore(
        {
          instituteId: institute.id,
          qrPayloadOrCode: vA.qrPayload,
          redemptionMethod: "QR_SCAN",
          upfrontDirectPaid: 102000,
          excludedNonTuitionAmount: 0,
          shortfallDisclosureAccepted: true,
        },
        ismAuth
      ),
      redeemBatchBuyVoucherCore(
        {
          instituteId: institute.id,
          qrPayloadOrCode: vA.qrPayload,
          redemptionMethod: "QR_SCAN",
          upfrontDirectPaid: 102000,
          excludedNonTuitionAmount: 0,
          shortfallDisclosureAccepted: true,
        },
        ismAuth
      ),
    ]);
    const won = [race1, race2].filter((r) => r.success);
    const lost = [race1, race2].filter((r) => !r.success);
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    const admAId = (won[0] as any).admissionId as string;
    cleanup.admissionIds.push(admAId);

    const dupScan = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vA.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      ismAuth
    );
    assert.equal(dupScan.success, false);

    const wrongInstRes = await redeemBatchBuyVoucherCore(
      {
        instituteId: otherInstitute.id,
        qrPayloadOrCode: vC.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      { userId: otherMgr.user.id, userName: "Other Mgr", actorRole: "MANAGER", isIsmRole: false }
    );
    assert.equal(wrongInstRes.success, false);

    const enqD = await prisma.instituteEnquiry.create({
      data: {
        instituteId: institute.id,
        name: stuD.user.name!,
        phone: stuD.user.phone!,
        email: stuD.user.email,
        course: batch.name,
        status: "CONTACTED",
      },
    });
    cleanup.enquiryIds.push(enqD.id);
    const directAdmD = await prisma.$transaction(async (tx) =>
      createAdmissionFromPipelineTx(tx, {
        enquiryId: enqD.id,
        instituteId: institute.id,
        batchId: batch.id,
        ismId: manager.user.id,
        studentName: stuD.user.name!,
        courseName: batch.name,
        totalFee: 120000,
        paidAmount: 20000,
        feeStatus: "PARTIAL",
        enquiryStatus: "CONVERTED",
        actorRole: "INSTITUTE_MANAGER",
        actorName: "Manager",
        activityContent: "Direct admission D",
        installments: [],
      })
    );
    cleanup.admissionIds.push(directAdmD.id);

    const memD = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort.id,
        userId: stuD.user.id,
        stage: "VOUCHER_ISSUED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: past16Days,
      },
    });
    const vD = await seedVoucherForMember(offer1, stuD.user, memD.id, cohort.id);
    const dupDirectRes = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vD.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      ismAuth
    );
    assert.equal(dupDirectRes.success, false);
    console.log("  [PASS] TEST 4 — ISM counter redemption, concurrency lock, wrong-institute & direct CRM duplicate guards.");

    // =========================================================================
    // TEST 5 — Quorum and fallback (ABSORB_SHORTFALL, REVERT_TO_LOWER_SLAB, CANCEL_DISCOUNT, non-resurrection, consent)
    // =========================================================================
    const cancelA = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: admAId,
        reason: "Student A cancelled before quorum.",
        directRefundRequiredAmount: 102000,
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelA.success, true);

    const memE = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort.id,
        userId: stuE.user.id,
        stage: "VOUCHER_ISSUED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: past16Days,
      },
    });
    const vE = await seedVoucherForMember(offer1, stuE.user, memE.id, cohort.id);
    const redC = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vC.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      ismAuth
    );
    assert.equal(redC.success, true);
    cleanup.admissionIds.push(redC.admissionId);

    const redE = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vE.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      ismAuth
    );
    assert.equal(redE.success, true);
    cleanup.admissionIds.push(redE.admissionId);

    const vAAfterPeers = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vA.voucher.id } });
    assert.equal(vAAfterPeers.settlementState, "CANCELLED_AFTER_REDEMPTION");

    const runFallbackScenario = async (
      policy: "ABSORB_SHORTFALL" | "REVERT_TO_LOWER_SLAB" | "CANCEL_DISCOUNT",
      stu: typeof stuF,
      tag: string
    ) => {
      const c = await prisma.groupAdmissionCohort.create({
        data: {
          cohortCode: `BB-${tag}-${RUN_TAG.slice(-4).toUpperCase()}`,
          title: `Fallback ${policy}`,
          instituteId: institute.id,
          batchId: batch.id,
          examCategory: "JEE",
          targetAcademicYear: 2026,
          minRequired: 1,
          targetSize: 3,
          maxCapacity: 5,
          status: "ADMISSION_OPEN",
          formingExpiresAt: futureExpiry,
          createdById: stu.user.id,
        },
      });
      cleanup.cohortIds.push(c.id);
      const m = await prisma.groupCohortMember.create({
        data: {
          cohortId: c.id,
          userId: stu.user.id,
          stage: "VOUCHER_ISSUED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
      });
      const expiredOffer = await prisma.cohortOffer.create({
        data: {
          cohortId: c.id,
          instituteId: institute.id,
          batchId: batch.id,
          version: 1,
          status: "QUORUM_MET",
          title: `Offer ${policy}`,
          baseFee: new Prisma.Decimal("120000.00"),
          registrationFeeOriginal: new Prisma.Decimal("0.00"),
          waiveRegistration: true,
          discountPercentage: new Prisma.Decimal("15.00"),
          discountAmount: new Prisma.Decimal("18000.00"),
          netPayableTuition: new Prisma.Decimal("102000.00"),
          includedPerks: [],
          fallbackPolicy: policy,
          minAcceptanceQuorum: 1,
          minAdmissionQuorum: 4,
          offerExpiresAt: futureExpiry,
          voucherExpiresAt: futureExpiry,
          publishedAt: past16Days,
          quorumMetAt: past16Days,
          createdById: manager.user.id,
          commissionAgreementId: ag2Row.id,
          commissionRatePctSnapshot: ag2Row.commissionRatePct,
          commissionTierSnapshot: ag2Row.rateTier,
          attributionWindowDaysSnapshot: 30,
          holdingPeriodDaysSnapshot: 15,
        },
      });
      const v = await seedVoucherForMember(expiredOffer, stu.user, m.id, c.id);
      const red = await redeemBatchBuyVoucherCore(
        {
          instituteId: institute.id,
          qrPayloadOrCode: v.qrPayload,
          redemptionMethod: "QR_SCAN",
          upfrontDirectPaid: 102000,
          excludedNonTuitionAmount: 0,
          shortfallDisclosureAccepted: true,
        },
        mgrAuth
      );
      assert.equal(red.success, true);
      cleanup.admissionIds.push(red.admissionId);

      await prisma.cohortOffer.update({
        where: { id: expiredOffer.id },
        data: { voucherExpiresAt: new Date(now.getTime() - 60_000) },
      });
      await prisma.admissionVoucher.update({
        where: { id: v.voucher.id },
        data: { expiresAt: new Date(now.getTime() - 60_000) },
      });
      const settle = await settleExpiredOfferAdmissionQuorumCore(expiredOffer.id, mgrAuth);
      assert.equal(settle.success, true);
      const vAfter = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: v.voucher.id } });
      return { offer: expiredOffer, voucher: vAfter, admissionId: red.admissionId };
    };

    const absorbRes = await runFallbackScenario("ABSORB_SHORTFALL", stuF, "ABS");
    assert.equal(absorbRes.voucher.settlementState, "SETTLED_FULL_DISCOUNT");

    const revertRes = await runFallbackScenario("REVERT_TO_LOWER_SLAB", stuG, "REV");
    assert.equal(revertRes.voucher.settlementState, "PENDING_STUDENT_FALLBACK_CONSENT");
    const acceptRev = await respondToFallbackAdjustmentCore(
      { voucherId: revertRes.voucher.id, acceptFallbackPrice: true },
      stuG.user.id
    );
    assert.equal(acceptRev.success, true);

    const stuH = await createAndSignInUser({
      name: "Student H",
      email: `${RUN_TAG}_stu_h@academyfind.test`,
      username: `${RUN_TAG}_stu_h`,
      phone: "9900220008",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const cancelDiscRes = await runFallbackScenario("CANCEL_DISCOUNT", stuH, "CAN");
    assert.equal(cancelDiscRes.voucher.settlementState, "PENDING_STUDENT_FALLBACK_CONSENT");
    const declineRev = await respondToFallbackAdjustmentCore(
      { voucherId: cancelDiscRes.voucher.id, acceptFallbackPrice: false },
      stuH.user.id
    );
    assert.equal(declineRev.success, true);
    const admH = await prisma.admissionRecord.findUniqueOrThrow({ where: { id: cancelDiscRes.admissionId } });
    assert.equal(admH.status, "CANCELLED");
    console.log("  [PASS] TEST 5 — ABSORB_SHORTFALL, REVERT_TO_LOWER_SLAB, CANCEL_DISCOUNT, non-resurrection & explicit consent verified.");

    // =========================================================================
    // TEST 6 — Anti-bypass (Web CRM + Mobile ISM HTTP route + Confirm bypass revokes unused voucher)
    // =========================================================================
    const stuBypassWeb = await createAndSignInUser({
      name: "Student Bypass Web",
      email: `${RUN_TAG}_bp_web@academyfind.test`,
      username: `${RUN_TAG}_bp_web`,
      phone: "9900330001",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const stuBypassMob = await createAndSignInUser({
      name: "Student Bypass Mob",
      email: `${RUN_TAG}_bp_mob@academyfind.test`,
      username: `${RUN_TAG}_bp_mob`,
      phone: "9900330002",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const [memBpW, memBpM] = await Promise.all([
      prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: stuBypassWeb.user.id,
          stage: "VOUCHER_ISSUED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
      }),
      prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: stuBypassMob.user.id,
          stage: "VOUCHER_ISSUED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
        },
      }),
    ]);
    await seedVoucherForMember(offer1, stuBypassWeb.user, memBpW.id, cohort.id);
    const vBpM = await seedVoucherForMember(offer1, stuBypassMob.user, memBpM.id, cohort.id);

    const enqWeb = await prisma.instituteEnquiry.create({
      data: {
        instituteId: institute.id,
        assignedIsmId: ism.user.id,
        name: stuBypassWeb.user.name!,
        phone: stuBypassWeb.user.phone!,
        email: stuBypassWeb.user.email,
        course: batch.name,
        status: "CONTACTED",
      },
    });
    const enqMob = await prisma.instituteEnquiry.create({
      data: {
        instituteId: institute.id,
        assignedIsmId: ism.user.id,
        name: stuBypassMob.user.name!,
        phone: stuBypassMob.user.phone!,
        email: stuBypassMob.user.email,
        course: batch.name,
        status: "CONTACTED",
      },
    });
    cleanup.enquiryIds.push(enqWeb.id, enqMob.id);

    const webConv = await prisma.$transaction(async (tx) => {
      const adm = await createAdmissionFromPipelineTx(tx, {
        instituteId: institute.id,
        enquiryId: enqWeb.id,
        batchId: batch.id,
        ismId: manager.user.id,
        studentName: enqWeb.name,
        courseName: batch.name,
        totalFee: 120000,
        paidAmount: 120000,
        feeStatus: "PAID",
        enquiryStatus: "CONVERTED",
        actorRole: "INSTITUTE_MANAGER",
        actorName: "Manager",
        activityContent: "Web CRM direct conversion",
        installments: [],
      });
      const bypass = await detectAndFlagPotentialBypassTx(tx, {
        instituteId: institute.id,
        admissionId: adm.id,
        enquiryId: enqWeb.id,
        leadName: enqWeb.name,
        leadPhone: enqWeb.phone,
        leadEmail: enqWeb.email ?? undefined,
        actorUserId: manager.user.id,
        actorRole: "INSTITUTE_MANAGER",
        now,
      });
      return { adm, bypass };
    });
    cleanup.admissionIds.push(webConv.adm.id);
    assert.equal(webConv.adm.status, "CONFIRMED");
    assert.equal(webConv.bypass.flagged, true);

    const mobHttp = await ism.client.postJson(`/api/mobile/ism/${institute.id}/leads/${enqMob.id}`, {
      action: "CONVERT_ADMISSION",
      courseName: batch.name,
      totalFee: 120000,
      admissionNote: "Staging mobile ISM direct conversion",
      installments: [{ amount: 120000, dueDate: now.toISOString(), status: "PAID" }],
    });
    assert.equal(mobHttp.status, 200, `Mobile ISM POST failed: ${mobHttp.status} ${mobHttp.body}`);
    assert.equal(mobHttp.json?.success, true);
    const mobAdm = await prisma.admissionRecord.findUniqueOrThrow({ where: { enquiryId: enqMob.id } });
    cleanup.admissionIds.push(mobAdm.id);

    const mobAttribution = await prisma.batchBuyAttribution.findFirstOrThrow({
      where: { admissionId: mobAdm.id },
    });
    assert.equal(mobAttribution.matchStatus, "FLAGGED_SUSPECTED_BYPASS");

    const confirmBypass = await reviewFlaggedAttributionCore(
      {
        attributionId: mobAttribution.id,
        decision: "CONFIRMED_BYPASS",
        reviewNote: "Confirmed bypass from mobile ISM direct conversion.",
      },
      admin.user.id
    );
    assert.equal(confirmBypass.success, true);
    assert.ok(confirmBypass.revokedVoucherIds.includes(vBpM.voucher.id));
    const vBpMAfter = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vBpM.voucher.id } });
    assert.equal(vBpMAfter.status, "REVOKED");
    console.log("  [PASS] TEST 6 — Web CRM & live HTTP Mobile ISM anti-bypass non-blocking, review created, unused voucher revoked.");

    // =========================================================================
    // TEST 7 — Commission and accounting (Maturation, Provisional block, Invoice, UTR, Duplicate UTR, DRAFT/ISSUED/PAID reversals)
    // =========================================================================
    const stuProv = await createAndSignInUser({
      name: "Student Prov",
      email: `${RUN_TAG}_stu_prov@academyfind.test`,
      username: `${RUN_TAG}_stu_prov`,
      phone: "9900440001",
      role: "USER",
      cleanupUserIds: cleanup.userIds,
    });
    const cohortProv = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-PRV-${RUN_TAG.slice(-4).toUpperCase()}`,
        title: "Provisional Hold Test",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        minRequired: 1,
        targetSize: 3,
        maxCapacity: 5,
        status: "ADMISSION_OPEN",
        formingExpiresAt: futureExpiry,
        createdById: stuProv.user.id,
      },
    });
    cleanup.cohortIds.push(cohortProv.id);
    const memProv = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohortProv.id,
        userId: stuProv.user.id,
        stage: "VOUCHER_ISSUED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: past16Days,
      },
    });
    const offerProv = await prisma.cohortOffer.create({
      data: {
        cohortId: cohortProv.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 1,
        status: "QUORUM_MET",
        title: "Provisional Hold Offer",
        baseFee: new Prisma.Decimal("120000.00"),
        registrationFeeOriginal: new Prisma.Decimal("0.00"),
        waiveRegistration: true,
        discountPercentage: new Prisma.Decimal("15.00"),
        discountAmount: new Prisma.Decimal("18000.00"),
        netPayableTuition: new Prisma.Decimal("102000.00"),
        includedPerks: [],
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        minAcceptanceQuorum: 1,
        minAdmissionQuorum: 3,
        offerExpiresAt: futureExpiry,
        voucherExpiresAt: futureExpiry,
        publishedAt: past16Days,
        quorumMetAt: past16Days,
        createdById: manager.user.id,
        commissionAgreementId: ag2Row.id,
        commissionRatePctSnapshot: ag2Row.commissionRatePct,
        commissionTierSnapshot: ag2Row.rateTier,
        attributionWindowDaysSnapshot: 30,
        holdingPeriodDaysSnapshot: 15,
      },
    });
    const vProv = await seedVoucherForMember(offerProv, stuProv.user, memProv.id, cohortProv.id);
    const redProv = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vProv.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(redProv.success, true);
    cleanup.admissionIds.push(redProv.admissionId);

    await prisma.commissionLedgerEntry.updateMany({
      where: {
        admissionId: { in: [redProv.admissionId, redC.admissionId, redE.admissionId, absorbRes.admissionId] },
      },
      data: { holdEndsAt: new Date(now.getTime() - 60_000) },
    });

    const matRes = await matureEligibleCommissionsCore(institute.id, admin.user.id);
    assert.equal(matRes.success, true);

    const [provLedger, cLedger] = await Promise.all([
      prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { admissionId: redProv.admissionId } }),
      prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { admissionId: redC.admissionId } }),
    ]);
    assert.equal(provLedger.status, "HOLD_PERIOD", "Provisional commission matured prematurely!");
    assert.equal(cLedger.status, "ELIGIBLE");

    const genDraft = await generateCommissionInvoiceCore(
      {
        instituteId: institute.id,
        periodStart: past16Days.toISOString(),
        periodEnd: new Date(now.getTime() + 60_000).toISOString(),
        taxTreatmentMode: "INTRA_STATE_CGST_SGST",
        issueImmediately: false,
      },
      admin.user.id
    );
    assert.equal(genDraft.success, true);
    cleanup.invoiceIds.push(genDraft.invoiceId);
    const inv1Before = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({ where: { id: genDraft.invoiceId } });

    const cancelC = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: redC.admissionId,
        reason: "Cancel admission associated with DRAFT invoice",
        directRefundRequiredAmount: 102000,
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelC.success, true);
    const inv1After = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({ where: { id: genDraft.invoiceId } });
    assert.ok(Number(inv1After.totalPayableAmount) < Number(inv1Before.totalPayableAmount), "DRAFT invoice did not recalculate");

    const issueInv1 = await issueCommissionInvoiceCore(genDraft.invoiceId, admin.user.id, "INTRA_STATE_CGST_SGST");
    assert.equal(issueInv1.success, true);
    const cancelE = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: redE.admissionId,
        reason: "Cancel admission associated with ISSUED invoice",
        directRefundRequiredAmount: 102000,
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelE.success, true);
    const inv1IssuedCheck = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({ where: { id: genDraft.invoiceId } });
    assert.equal(Number(inv1IssuedCheck.totalPayableAmount), Number(inv1After.totalPayableAmount), "ISSUED invoice was mutated!");
    const cnIssued = await prisma.batchBuyCreditNote.findUniqueOrThrow({
      where: { creditNoteNumber: cancelE.creditNoteNumber! },
    });
    assert.equal(cnIssued.status, "APPLIED_TO_INVOICE");
    assert.equal(Number(cnIssued.refundPayableToInstitute), 0);

    const remainingTotal = Number(inv1IssuedCheck.totalPayableAmount) - Number(cnIssued.totalCreditAmount);
    const utr = `UTR-${RUN_TAG}-001`;
    const payRes = await recordCommissionPaymentCore(
      {
        invoiceId: genDraft.invoiceId,
        amount: remainingTotal,
        utrOrReference: utr,
        paymentMode: "NEFT",
      },
      admin.user.id
    );
    assert.equal(payRes.success, true);

    const dupUtrRes = await recordCommissionPaymentCore(
      {
        invoiceId: genDraft.invoiceId,
        amount: 100,
        utrOrReference: utr,
        paymentMode: "NEFT",
      },
      admin.user.id
    );
    assert.equal(dupUtrRes.success, false);

    const cancelAbsorb = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: absorbRes.admissionId,
        reason: "Cancel admission associated with PAID invoice",
        directRefundRequiredAmount: 102000,
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelAbsorb.success, true);
    const cnPaid = await prisma.batchBuyCreditNote.findUniqueOrThrow({
      where: { creditNoteNumber: cancelAbsorb.creditNoteNumber! },
    });
    assert.equal(cnPaid.status, "REFUND_PENDING");
    assert.ok(Number(cnPaid.refundPayableToInstitute) > 0);
    const refundUtrRes = await settleCreditNoteRefundCore(
      {
        creditNoteId: cnPaid.id,
        utrOrReference: `REFUND-UTR-${RUN_TAG}`,
      },
      admin.user.id
    );
    assert.equal(refundUtrRes.success, true);
    const cnPaidSettled = await prisma.batchBuyCreditNote.findUniqueOrThrow({ where: { id: cnPaid.id } });
    assert.equal(cnPaidSettled.status, "REFUNDED");
    console.log("  [PASS] TEST 7 — Provisional hold guard, invoice issuance, UTR + dup UTR rejection, DRAFT/ISSUED/PAID reversals, Credit Notes & refund UTR verified.");

    // =========================================================================
    // TEST 8 — Security, key rotation, cross-institute denial & audit survival
    // =========================================================================
    const [crossMgrSlabs, crossMgrRedeem, stuAdminDenied] = await Promise.all([
      otherMgr.client.get(`/manager/${institute.id}/batchbuy/slabs`),
      otherMgr.client.get(`/manager/${institute.id}/batchbuy/redemptions`),
      stuA.client.get("/af-ass-manage/batchbuy"),
    ]);
    const assertDenied = (res: { status: number; body: string }, label: string) => {
      const hasWorkspace =
        res.body.includes("BatchBuy™ Settlement") ||
        res.body.includes("BatchBuy Reconciliation") ||
        res.body.includes(institute.name);
      assert.equal(hasWorkspace, false, `${label} unexpectedly leaked BatchBuy workspace HTML`);
      assert.ok(
        res.status !== 200 ||
          /access denied|unauthorized|not authorized|permission|admin access required|access or loading error/i.test(res.body),
        `${label} was not denied cleanly (status=${res.status})`
      );
    };
    assertDenied(crossMgrSlabs, "Cross-institute manager slabs");
    assertDenied(crossMgrRedeem, "Cross-institute manager redemptions");
    assertDenied(stuAdminDenied, "Student platform admin batchbuy");

    const legacyArt = generateVoucherArtifacts({
      offerId: offer1.id,
      offerVersion: offer1.version,
      cohortId: cohort.id,
      cohortMemberId: memMap.get(stuA.user.id)!,
      userId: stuA.user.id,
      instituteId: institute.id,
      batchId: batch.id,
    });
    const k1Secret = process.env.VOUCHER_HMAC_PREVIOUS_SECRETS!.split(",")[0].split(":")[1];
    const savedKid = process.env.VOUCHER_HMAC_KEY_ID;
    const savedVSecret = process.env.VOUCHER_HMAC_SECRET;
    process.env.VOUCHER_HMAC_KEY_ID = "k1";
    process.env.VOUCHER_HMAC_SECRET = k1Secret;
    const legacyQr = computeVoucherQrPayload({
      voucherCode: legacyArt.voucherCode,
      securityNonce: legacyArt.securityNonce,
      offerId: offer1.id,
      offerVersion: offer1.version,
      cohortId: cohort.id,
      cohortMemberId: memMap.get(stuA.user.id)!,
      userId: stuA.user.id,
      instituteId: institute.id,
      batchId: batch.id,
      expiresAtIso: futureExpiry.toISOString(),
    });
    process.env.VOUCHER_HMAC_KEY_ID = savedKid;
    process.env.VOUCHER_HMAC_SECRET = savedVSecret;

    const currentQr = computeVoucherQrPayload({
      voucherCode: legacyArt.voucherCode,
      securityNonce: legacyArt.securityNonce,
      offerId: offer1.id,
      offerVersion: offer1.version,
      cohortId: cohort.id,
      cohortMemberId: memMap.get(stuA.user.id)!,
      userId: stuA.user.id,
      instituteId: institute.id,
      batchId: batch.id,
      expiresAtIso: futureExpiry.toISOString(),
    });
    const storedForRot = {
      voucherCode: legacyArt.voucherCode,
      securityNonce: legacyArt.securityNonce,
      offerId: offer1.id,
      offerVersion: offer1.version,
      cohortId: cohort.id,
      cohortMemberId: memMap.get(stuA.user.id)!,
      userId: stuA.user.id,
      instituteId: institute.id,
      batchId: batch.id,
      expiresAtIso: futureExpiry.toISOString(),
      tokenHash: legacyArt.tokenHash,
      status: "ACTIVE",
      expiresAt: futureExpiry,
    };
    assert.equal(
      verifyVoucherQrPresentation({ qrPayloadRaw: legacyQr.qrPayload, storedVoucher: storedForRot }).valid,
      true
    );
    assert.equal(
      verifyVoucherQrPresentation({ qrPayloadRaw: currentQr.qrPayload, storedVoucher: storedForRot }).valid,
      true
    );

    const prevOtpSecret = process.env.GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS!;
    const legacyChallenge = createGuardianConsentChallenge(memCId);
    const legacyHash = hashGuardianOtp(legacyChallenge.salt, legacyChallenge.otp, memCId, prevOtpSecret);
    assert.equal(verifyGuardianOtpHash(legacyChallenge.salt, legacyChallenge.otp, legacyHash, memCId), true);

    const tempInst = await prisma.institute.create({
      data: {
        name: `Temp Audit Inst ${RUN_TAG}`,
        slug: `${RUN_TAG}-temp-audit`,
        address: "303 Audit Lane, Jaipur",
        cityId: city.id,
      },
    });
    const auditRow = await prisma.$transaction((tx) =>
      writeBatchBuyAuditLogTx(tx, {
        instituteId: tempInst.id,
        actorUserId: admin.user.id,
        actorRole: "ADMIN",
        action: "STAGING_AUDIT_SURVIVAL_CHECK",
        entityType: "Institute",
        entityId: tempInst.id,
        reason: "Verify audit trail survives institute deletion",
      })
    );
    await prisma.institute.delete({ where: { id: tempInst.id } });
    const survivingAudit = await prisma.batchBuyAuditLog.findUniqueOrThrow({ where: { id: auditRow.id } });
    assert.equal(survivingAudit.instituteId, null);
    assert.equal(survivingAudit.instituteIdSnapshot, tempInst.id);
    await prisma.batchBuyAuditLog.delete({ where: { id: auditRow.id } });

    const auditActions = await prisma.batchBuyAuditLog.findMany({
      where: { OR: [{ instituteId: institute.id }, { instituteIdSnapshot: institute.id }] },
      select: { action: true },
    });
    const actionSet = new Set(auditActions.map((a) => a.action));
    assert.ok(actionSet.has("SLABS_SAVED"), "Missing SLABS_SAVED audit log");
    assert.ok(actionSet.has("AGREEMENT_ACTIVATED"), "Missing AGREEMENT_ACTIVATED audit log");
    assert.ok(actionSet.has("VOUCHER_REDEEMED"), "Missing VOUCHER_REDEEMED audit log");
    assert.ok(actionSet.has("INVOICE_ISSUED"), "Missing INVOICE_ISSUED audit log");
    assert.ok(actionSet.has("CREDIT_NOTE_REFUND_SETTLED"), "Missing CREDIT_NOTE_REFUND_SETTLED audit log");
    console.log("  [PASS] TEST 8 — Role/cross-institute security, HMAC & OTP key rotation, and audit survival verified.");

    console.log("\n[BatchBuy Staging Acceptance] ALL 8 STAGING ACCEPTANCE SUITES PASSED.");
  } finally {
    if (cleanup.instituteIds.length > 0) {
      await prisma.batchBuyAuditLog.deleteMany({
        where: {
          OR: [
            { instituteId: { in: cleanup.instituteIds } },
            { instituteIdSnapshot: { in: cleanup.instituteIds } },
          ],
        },
      });
      await prisma.batchBuyCreditNote.deleteMany({
        where: { instituteIdSnapshot: { in: cleanup.instituteIds } },
      });
      await prisma.commissionLedgerEntry.deleteMany({
        where: { instituteId: { in: cleanup.instituteIds } },
      });
      await prisma.batchBuyAttribution.deleteMany({
        where: { instituteId: { in: cleanup.instituteIds } },
      });
    }
    if (cleanup.invoiceIds.length > 0) {
      await prisma.commissionPaymentRecord.deleteMany({
        where: { invoiceId: { in: cleanup.invoiceIds } },
      });
      await prisma.batchBuyCommissionInvoice.deleteMany({
        where: { id: { in: cleanup.invoiceIds } },
      });
    }
    if (cleanup.admissionIds.length > 0) {
      await prisma.admissionRecord.deleteMany({ where: { id: { in: cleanup.admissionIds } } });
    }
    if (cleanup.cohortIds.length > 0) {
      await prisma.admissionVoucher.deleteMany({ where: { cohortId: { in: cleanup.cohortIds } } });
      await prisma.groupOfferDecision.deleteMany({ where: { cohortId: { in: cleanup.cohortIds } } });
      await prisma.cohortOffer.deleteMany({ where: { cohortId: { in: cleanup.cohortIds } } });
      await prisma.groupCohortMember.deleteMany({ where: { cohortId: { in: cleanup.cohortIds } } });
      await prisma.groupAdmissionCohort.deleteMany({ where: { id: { in: cleanup.cohortIds } } });
    }
    if (cleanup.enquiryIds.length > 0) {
      await prisma.instituteEnquiry.deleteMany({ where: { id: { in: cleanup.enquiryIds } } });
    }
    if (cleanup.conversationIds.length > 0) {
      await prisma.conversation.deleteMany({ where: { id: { in: cleanup.conversationIds } } });
    }
    if (cleanup.instituteIds.length > 0) {
      await prisma.instituteBatchBuyAgreement.deleteMany({ where: { instituteId: { in: cleanup.instituteIds } } });
      await prisma.groupDiscountSlab.deleteMany({ where: { instituteId: { in: cleanup.instituteIds } } });
      await prisma.instituteSalesManagerAssignment.deleteMany({ where: { instituteId: { in: cleanup.instituteIds } } });
      await prisma.instituteMembership.deleteMany({ where: { instituteId: { in: cleanup.instituteIds } } });
      await prisma.instituteManager.deleteMany({ where: { instituteId: { in: cleanup.instituteIds } } });
    }
    if (cleanup.batchIds.length > 0) {
      await prisma.instituteBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
    }
    if (cleanup.instituteIds.length > 0) {
      await prisma.institute.deleteMany({ where: { id: { in: cleanup.instituteIds } } });
    }
    if (cleanup.userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    }
    await prisma.$disconnect();
    console.log(`[BatchBuy Staging Acceptance] Cleanup complete for ${RUN_TAG}.`);
  }
}

main().catch((err) => {
  console.error("[BatchBuy Staging Acceptance] FAILED:", err);
  process.exit(1);
});
