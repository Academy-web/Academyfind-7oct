/**
 * Real PostgreSQL (Neon) E2E Regression & Concurrency Suite for BatchBuy Audit Remediation.
 * Exercises ALL actual transactional core modules (`lib/batchbuy/core/*`, `admissionPipeline`,
 * `resolveQualifyingLowerSlabPctTx`, `BatchBuyAuditLog`, `BatchBuyCreditNote`) directly against
 * live Neon Postgres — zero mocked ORM substitutes.
 *
 * Run: npx tsx tests/batchbuy/remediationPostgres.e2e.ts
 */

import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { Prisma } from "../../app/generated/prisma/client";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
} from "../../lib/batchbuy/voucherCrypto";
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
import { writeBatchBuyAuditLogTx } from "../../lib/batchbuy/redemptionAuth";

const RUN_TAG = `__rem_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function main() {
  console.log(`\n[BatchBuy Remediation Real Postgres E2E] Starting run ${RUN_TAG}...`);

  const cleanup = {
    userIds: [] as string[],
    instituteIds: [] as string[],
    batchIds: [] as string[],
    cohortIds: [] as string[],
    enquiryIds: [] as string[],
    admissionIds: [] as string[],
    invoiceIds: [] as string[],
  };

  try {
    const city = await prisma.city.findFirst({ select: { id: true } });
    if (!city) throw new Error("No City row found in database.");

    const now = new Date();
    const past16Days = new Date(now.getTime() - 16 * 86_400_000);
    const futureExpiry = new Date(now.getTime() + 7 * 86_400_000);

    // Seed Platform Admin, Manager, and Students A..F
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: "Remediation Admin",
          username: `${RUN_TAG}_adm`,
          email: `${RUN_TAG}_adm@academyfind.test`,
          role: "ADMIN",
          isActive: true,
          phoneVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Remediation Manager",
          username: `${RUN_TAG}_mgr`,
          email: `${RUN_TAG}_mgr@academyfind.test`,
          role: "USER",
          isActive: true,
          phoneVerified: true,
        },
      }),
      ...["A", "B", "C", "D", "E", "F"].map((lbl, idx) =>
        prisma.user.create({
          data: {
            name: `Student ${lbl}`,
            username: `${RUN_TAG}_stu_${lbl.toLowerCase()}`,
            email: `${RUN_TAG}_stu_${lbl.toLowerCase()}@academyfind.test`,
            phone: `997766001${idx}`,
            role: "USER",
            isActive: true,
            phoneVerified: true,
          },
        })
      ),
    ]);
    const [adminUser, managerUser, stuA, stuB, stuC, stuD, stuE, stuF] = users;
    cleanup.userIds.push(...users.map((u) => u.id));

    const institute = await prisma.institute.create({
      data: {
        name: `Remediation Institute ${RUN_TAG}`,
        slug: `${RUN_TAG}-inst`,
        address: "42 Commerce Hub, Kota",
        cityId: city.id,
      },
    });
    cleanup.instituteIds.push(institute.id);

    await prisma.instituteManager.create({
      data: { userId: managerUser.id, instituteId: institute.id },
    });

    const batch = await prisma.instituteBatch.create({
      data: {
        instituteId: institute.id,
        slug: `${RUN_TAG}-batch`,
        name: "JEE Intensive 2026",
        courseName: "JEE",
        fee: 120000,
        originalFee: 120000,
      },
    });
    cleanup.batchIds.push(batch.id);

    // -------------------------------------------------------------------------
    // TEST 1: PascalCase "Institute" row lock in agreement save/activation + overlap closure
    // -------------------------------------------------------------------------
    const ag1Res = await saveInstituteBatchBuyAgreementCore(
      {
        instituteId: institute.id,
        rateTier: "PARTNER_2_PCT",
        gstRatePct: 18,
        gstTreatmentNote: "Initial 2% draft agreement before CA SAC signoff",
        sacCode: null,
        sacValidatedByCa: false,
        attributionWindowDays: 30,
        holdingPeriodDays: 15,
        paymentDueDays: 15,
        cancellationClawbackPolicy: "15-day commercial cooling-off hold on tuition commission.",
        effectiveFrom: past16Days.toISOString(),
        effectiveTo: null,
        activateImmediately: true,
        acceptedRepresentativeName: "Director V1",
        acceptedDesignation: "Managing Director",
      },
      adminUser.id
    );
    assert.equal(ag1Res.success, true, `Agreement v1 creation failed: ${"error" in ag1Res ? ag1Res.error : ""}`);
    assert.equal(ag1Res.status, "ACTIVE");

    // Draft v2 with complete CA signoff metadata and activate via acceptAndActivateAgreementCore
    const ag2Save = await saveInstituteBatchBuyAgreementCore(
      {
        instituteId: institute.id,
        rateTier: "STANDARD_3_PCT",
        gstRatePct: 18,
        gstTreatmentNote: "3% standard agreement CA-validated under SAC 998399.",
        sacCode: "998399",
        sacValidatedByCa: true,
        caValidatorName: "CA Arvind Mehta",
        caMembershipNumber: "145920",
        caValidationNote: "Reviewed GST placement rules and SAC 998399.",
        attributionWindowDays: 30,
        holdingPeriodDays: 15,
        paymentDueDays: 15,
        cancellationClawbackPolicy: "15-day cooling-off; post-hold reversals issue GST credit notes.",
        effectiveFrom: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
        effectiveTo: null,
        activateImmediately: false,
      },
      adminUser.id
    );
    assert.equal(ag2Save.success, true);

    const ag2Act = await acceptAndActivateAgreementCore(
      {
        agreementId: ag2Save.agreementId,
        acceptedRepresentativeName: "Director V2",
        acceptedDesignation: "Director",
      },
      adminUser.id,
      "ADMIN"
    );
    assert.equal(ag2Act.success, true, `Agreement v2 activation failed: ${"error" in ag2Act ? ag2Act.error : ""}`);

    const [ag1Db, ag2Db] = await Promise.all([
      prisma.instituteBatchBuyAgreement.findUniqueOrThrow({ where: { id: ag1Res.agreementId } }),
      prisma.instituteBatchBuyAgreement.findUniqueOrThrow({ where: { id: ag2Save.agreementId } }),
    ]);
    assert.equal(ag1Db.status, "SUPERSEDED");
    assert.equal(ag1Db.effectiveTo?.toISOString(), ag2Db.effectiveFrom.toISOString());
    assert.equal(ag2Db.status, "ACTIVE");
    console.log("  [PASS] 1. Agreement save/activation ('Institute' PascalCase) & zero-gap overlap closure.");

    // Seed Cohort 1 (minAdmissionQuorum = 2, ABSORB_SHORTFALL) + Vouchers for A, B, C, D, E, F
    const cohort1 = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-R1-${RUN_TAG.slice(-6).toUpperCase()}`,
        title: "Remediation Main Cohort",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        minRequired: 2,
        targetSize: 6,
        maxCapacity: 10,
        status: "ADMISSION_OPEN",
        formingExpiresAt: futureExpiry,
        createdById: stuA.id,
      },
    });
    cleanup.cohortIds.push(cohort1.id);

    const members = await Promise.all(
      [stuA, stuB, stuC, stuD, stuE, stuF].map((stu) =>
        prisma.groupCohortMember.create({
          data: {
            cohortId: cohort1.id,
            userId: stu.id,
            stage: "VOUCHER_ISSUED",
            phoneVerified: true,
            profileConfirmed: true,
            explicitIntentAt: past16Days,
            joinedAt: past16Days,
          },
        })
      )
    );
    const [memA, memB, memC, memD, memE, memF] = members;

    const offer1 = await prisma.cohortOffer.create({
      data: {
        cohortId: cohort1.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 1,
        status: "QUORUM_MET",
        title: "Remediation 15% Offer",
        baseFee: new Prisma.Decimal("120000.00"),
        registrationFeeOriginal: new Prisma.Decimal("0.00"),
        waiveRegistration: true,
        discountPercentage: new Prisma.Decimal("15.00"),
        discountAmount: new Prisma.Decimal("18000.00"),
        netPayableTuition: new Prisma.Decimal("102000.00"),
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        minAcceptanceQuorum: 2,
        minAdmissionQuorum: 2,
        offerExpiresAt: futureExpiry,
        voucherExpiresAt: futureExpiry,
        publishedAt: past16Days,
        quorumMetAt: past16Days,
        createdById: managerUser.id,
        commissionAgreementId: ag2Db.id,
        commissionRatePctSnapshot: ag2Db.commissionRatePct,
        commissionTierSnapshot: ag2Db.rateTier,
        attributionWindowDaysSnapshot: 30,
        holdingPeriodDaysSnapshot: 15,
      },
    });

    async function seedVoucherForMember(
      o: typeof offer1,
      stu: typeof stuA,
      mem: typeof memA,
      cId: string
    ) {
      const dec = await prisma.groupOfferDecision.create({
        data: {
          offerId: o.id,
          cohortId: cId,
          cohortMemberId: mem.id,
          userId: stu.id,
          decision: "ACCEPTED",
          revalidatedIntentAt: past16Days,
          decidedAt: past16Days,
        },
      });
      const art = generateVoucherArtifacts({
        offerId: o.id,
        offerVersion: o.version,
        cohortId: cId,
        cohortMemberId: mem.id,
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
          cohortMemberId: mem.id,
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
        cohortMemberId: mem.id,
        userId: stu.id,
        instituteId: institute.id,
        batchId: batch.id,
        expiresAtIso: o.voucherExpiresAt.toISOString(),
      });
      return { voucher, qrPayload: qr.qrPayload };
    }

    const [vA, vB, vC, vD, vE, vF] = await Promise.all([
      seedVoucherForMember(offer1, stuA, memA, cohort1.id),
      seedVoucherForMember(offer1, stuB, memB, cohort1.id),
      seedVoucherForMember(offer1, stuC, memC, cohort1.id),
      seedVoucherForMember(offer1, stuD, memD, cohort1.id),
      seedVoucherForMember(offer1, stuE, memE, cohort1.id),
      seedVoucherForMember(offer1, stuF, memF, cohort1.id),
    ]);

    const mgrAuth = {
      userId: managerUser.id,
      userName: managerUser.name || "Manager",
      actorRole: "INSTITUTE_MANAGER",
      isIsmRole: false,
    };

    // -------------------------------------------------------------------------
    // TEST 2: Concurrent double-redemption prevention on Student A's voucher
    // -------------------------------------------------------------------------
    const raceA = await Promise.all([
      redeemBatchBuyVoucherCore(
        {
          instituteId: institute.id,
          qrPayloadOrCode: vA.qrPayload,
          redemptionMethod: "QR_SCAN",
          upfrontDirectPaid: 102000,
          excludedNonTuitionAmount: 0,
          shortfallDisclosureAccepted: true,
        },
        mgrAuth
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
        mgrAuth
      ),
    ]);
    const winsA = raceA.filter((r) => r.success);
    const losesA = raceA.filter((r) => !r.success);
    assert.equal(winsA.length, 1, `Expected 1 win in raceA, got: ${JSON.stringify(raceA)}`);
    assert.equal(losesA.length, 1, `Expected 1 loss in raceA, got: ${JSON.stringify(raceA)}`);
    const admAId = winsA[0].admissionId;
    cleanup.admissionIds.push(admAId);
    console.log("  [PASS] 2. Concurrent double-redemption on same voucher blocked (1 win, 1 reject).");

    // -------------------------------------------------------------------------
    // TEST 3: Existing confirmed direct CRM admission blocks duplicate BatchBuy redemption
    // -------------------------------------------------------------------------
    const enqD = await prisma.instituteEnquiry.create({
      data: {
        instituteId: institute.id,
        name: stuD.name || "Student D",
        phone: stuD.phone || "9977660013",
        email: stuD.email || "",
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
        ismId: managerUser.id,
        studentName: stuD.name || "Student D",
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

    const dupRedeemD = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vD.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(dupRedeemD.success, false);
    assert.match(dupRedeemD.error || "", /active direct CRM admission/i);
    console.log("  [PASS] 3. Direct confirmed admission blocks duplicate BatchBuy voucher redemption cleanly.");

    // -------------------------------------------------------------------------
    // TEST 4: Pipeline bypass detection + CONFIRMED_BYPASS revokes candidate voucher C
    // -------------------------------------------------------------------------
    const enqC = await prisma.instituteEnquiry.create({
      data: {
        instituteId: institute.id,
        name: stuC.name || "Student C",
        phone: stuC.phone || "9977660012",
        email: stuC.email || "",
        course: batch.name,
        status: "CONTACTED",
      },
    });
    cleanup.enquiryIds.push(enqC.id);

    const bypassResultC = await prisma.$transaction(async (tx) => {
      const adm = await createAdmissionFromPipelineTx(tx, {
        enquiryId: enqC.id,
        instituteId: institute.id,
        batchId: batch.id,
        ismId: managerUser.id,
        studentName: stuC.name || "Student C",
        courseName: batch.name,
        totalFee: 115000,
        paidAmount: 15000,
        feeStatus: "PARTIAL",
        enquiryStatus: "CONVERTED",
        actorRole: "INSTITUTE_SALES_MANAGER",
        actorName: "ISM",
        activityContent: "Mobile ISM converted C outside voucher flow",
        installments: [],
      });
      const bypass = await detectAndFlagPotentialBypassTx(tx, {
        admissionId: adm.id,
        enquiryId: enqC.id,
        instituteId: institute.id,
        leadName: stuC.name || "Student C",
        leadPhone: stuC.phone || "9977660012",
        leadEmail: stuC.email ?? undefined,
        actorUserId: managerUser.id,
        actorRole: "INSTITUTE_SALES_MANAGER",
        now,
      });
      return { adm, bypass };
    });
    cleanup.admissionIds.push(bypassResultC.adm.id);
    assert.equal(bypassResultC.bypass.flagged, true);
    assert.ok(bypassResultC.bypass.attributionId);

    const confirmBypass = await reviewFlaggedAttributionCore(
      {
        attributionId: bypassResultC.bypass.attributionId!,
        decision: "CONFIRMED_BYPASS",
        reviewNote: "Matched mobile ISM direct admission after BatchBuy voucher issuance.",
      },
      adminUser.id
    );
    assert.equal(confirmBypass.success, true);
    assert.ok(confirmBypass.revokedVoucherIds.includes(vC.voucher.id));

    const vCAfter = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vC.voucher.id } });
    assert.equal(vCAfter.status, "REVOKED");

    const redeemAfterRevoke = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vC.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(redeemAfterRevoke.success, false);
    console.log("  [PASS] 4. Confirmed CRM/ISM bypass atomically revokes unused candidate voucher.");

    // -------------------------------------------------------------------------
    // TEST 5: Provisional cancellation non-resurrection when peers cross minAdmissionQuorum
    // -------------------------------------------------------------------------
    const cancelA = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: admAId,
        reason: "Student A cancelled while cohort was still below admission quorum.",
        directRefundRequiredAmount: 102000,
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelA.success, true);
    assert.equal(cancelA.commissionStatus, "VOIDED_COOLING_OFF");

    const vAAfterCancel = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vA.voucher.id } });
    assert.equal(vAAfterCancel.settlementState, "CANCELLED_AFTER_REDEMPTION");

    // Redeem Student B and Student E -> quorum = 2 reached! Verify vA is NOT resurrected!
    const redeemB = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vB.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(redeemB.success, true);
    cleanup.admissionIds.push(redeemB.admissionId);

    const redeemE = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vE.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(redeemE.success, true);
    cleanup.admissionIds.push(redeemE.admissionId);

    const [vAFinal, admAFinal, redeemF] = await Promise.all([
      prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vA.voucher.id } }),
      prisma.admissionRecord.findUniqueOrThrow({ where: { id: admAId } }),
      redeemBatchBuyVoucherCore(
        {
          instituteId: institute.id,
          qrPayloadOrCode: vF.qrPayload,
          redemptionMethod: "QR_SCAN",
          upfrontDirectPaid: 102000,
          excludedNonTuitionAmount: 0,
          shortfallDisclosureAccepted: true,
        },
        mgrAuth
      ),
    ]);
    assert.equal(vAFinal.settlementState, "CANCELLED_AFTER_REDEMPTION");
    assert.equal(admAFinal.status, "REFUNDED");
    assert.equal(redeemF.success, true);
    cleanup.admissionIds.push(redeemF.admissionId);
    console.log("  [PASS] 5. Cancelled provisional voucher never resurrected when peer admissions reach quorum.");

    // -------------------------------------------------------------------------
    // TEST 6 & 7: Provisional hold guard + Fixed lower-slab resolver (archived & scope isolation)
    // -------------------------------------------------------------------------
    // Configure slabs for lower-slab test on Cohort 2:
    // - Archived batch override 10% (1-2 students) -> MUST BE IGNORED
    // - Active institute-wide default 8% (1-2 students) -> MUST BE BLOCKED when any active batch override exists
    // - Active batch override 12% (3-5 students) -> forces confirmedCount=1 into 0% qualifyingLowerSlabPct
    await prisma.groupDiscountSlab.createMany({
      data: [
        {
          instituteId: institute.id,
          batchId: batch.id,
          minStudents: 1,
          maxStudents: 2,
          discountPercentage: new Prisma.Decimal("10.00"),
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          isActive: false,
          isArchived: true,
          createdById: managerUser.id,
        },
        {
          instituteId: institute.id,
          batchId: null,
          minStudents: 1,
          maxStudents: 2,
          discountPercentage: new Prisma.Decimal("8.00"),
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          isActive: true,
          isArchived: false,
          createdById: managerUser.id,
        },
        {
          instituteId: institute.id,
          batchId: batch.id,
          minStudents: 3,
          maxStudents: 5,
          discountPercentage: new Prisma.Decimal("12.00"),
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          isActive: true,
          isArchived: false,
          createdById: managerUser.id,
        },
      ],
    });

    const stuG = await prisma.user.create({
      data: {
        name: "Student G",
        username: `${RUN_TAG}_stu_g`,
        email: `${RUN_TAG}_stu_g@academyfind.test`,
        phone: "9977660019",
        role: "USER",
        isActive: true,
        phoneVerified: true,
      },
    });
    cleanup.userIds.push(stuG.id);

    const cohort2 = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-R2-${RUN_TAG.slice(-6).toUpperCase()}`,
        title: "Remediation Quorum Open Cohort",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        minRequired: 1,
        targetSize: 3,
        maxCapacity: 5,
        status: "ADMISSION_OPEN",
        formingExpiresAt: futureExpiry,
        createdById: stuG.id,
      },
    });
    cleanup.cohortIds.push(cohort2.id);

    const memG = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort2.id,
        userId: stuG.id,
        stage: "VOUCHER_ISSUED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: past16Days,
        joinedAt: past16Days,
      },
    });

    const offer2 = await prisma.cohortOffer.create({
      data: {
        cohortId: cohort2.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 1,
        status: "QUORUM_MET",
        title: "Remediation Lower Slab Test",
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
        createdById: managerUser.id,
        commissionAgreementId: ag2Db.id,
        commissionRatePctSnapshot: ag2Db.commissionRatePct,
        commissionTierSnapshot: ag2Db.rateTier,
        attributionWindowDaysSnapshot: 30,
        holdingPeriodDaysSnapshot: 15,
      },
    });
    const vG = await seedVoucherForMember(offer2, stuG, memG, cohort2.id);
    const redeemG = await redeemBatchBuyVoucherCore(
      {
        instituteId: institute.id,
        qrPayloadOrCode: vG.qrPayload,
        redemptionMethod: "QR_SCAN",
        upfrontDirectPaid: 102000,
        excludedNonTuitionAmount: 0,
        shortfallDisclosureAccepted: true,
      },
      mgrAuth
    );
    assert.equal(redeemG.success, true);
    cleanup.admissionIds.push(redeemG.admissionId);

    // Backdate holdEndsAt on Student G's PROVISIONAL_QUORUM_OPEN commission ledger -> MUST NOT mature!
    await prisma.commissionLedgerEntry.update({
      where: { admissionId: redeemG.admissionId },
      data: { holdEndsAt: new Date(now.getTime() - 60_000) },
    });
    const earlyMature = await matureEligibleCommissionsCore(institute.id, adminUser.id);
    assert.equal(earlyMature.maturedCount, 0);
    const commGCheck = await prisma.commissionLedgerEntry.findUniqueOrThrow({
      where: { admissionId: redeemG.admissionId },
    });
    assert.equal(commGCheck.status, "HOLD_PERIOD");
    console.log("  [PASS] 6. Provisional commission hold guard blocks early maturation/invoicing before quorum settles.");

    // Now expire offer2 voucher window and settle admission quorum -> must ignore archived 10% and inst-default 8%
    await prisma.cohortOffer.update({
      where: { id: offer2.id },
      data: { voucherExpiresAt: new Date(now.getTime() - 60_000) },
    });
    const settle2 = await settleExpiredOfferAdmissionQuorumCore(offer2.id, {
      userId: managerUser.id,
      actorRole: "INSTITUTE_MANAGER",
    });
    assert.equal(settle2.success, true);
    assert.equal(settle2.mode, "PENDING_STUDENT_FALLBACK_CONSENT");

    const vGAfterSettle = await prisma.admissionVoucher.findUniqueOrThrow({ where: { id: vG.voucher.id } });
    // Strict batch scope + ignored archived slab -> 0% discount -> full ₹1,20,000 disclosed fee!
    assert.equal(Number(vGAfterSettle.disclosedFallbackFee), 120000);

    // Student G declines fallback price -> penalty-free cancellation + VOIDED_COOLING_OFF
    const declineG = await respondToFallbackAdjustmentCore(
      {
        voucherId: vG.voucher.id,
        acceptFallbackPrice: false,
        note: "Declining full ₹1,20,000 fallback fee",
      },
      stuG.id
    );
    assert.equal(declineG.success, true);
    const commGFinal = await prisma.commissionLedgerEntry.findUniqueOrThrow({
      where: { admissionId: redeemG.admissionId },
    });
    assert.equal(commGFinal.status, "VOIDED_COOLING_OFF");
    console.log("  [PASS] 7. Lower-slab resolver ignores archived & default slabs on batch override; decline voids cleanly.");

    // -------------------------------------------------------------------------
    // TEST 8: CA Validation Gate, DRAFT recalculation, ISSUED/PAID Credit Notes + Concurrent Issue
    // -------------------------------------------------------------------------
    // Age matured entries for B, E, F past 15d hold (settlementState is SETTLED_FULL_DISCOUNT)
    await prisma.commissionLedgerEntry.updateMany({
      where: { admissionId: { in: [redeemB.admissionId, redeemE.admissionId, redeemF.admissionId] } },
      data: { holdEndsAt: new Date(now.getTime() - 60_000) },
    });
    const matureMain = await matureEligibleCommissionsCore(institute.id, adminUser.id);
    assert.equal(matureMain.maturedCount, 3);

    // Block immediate issuance when taxTreatmentMode is PENDING_CA_VALIDATION
    const blockedPendingCa = await generateCommissionInvoiceCore(
      {
        instituteId: institute.id,
        periodStart: past16Days.toISOString(),
        periodEnd: new Date(now.getTime() + 60_000).toISOString(),
        taxTreatmentMode: "PENDING_CA_VALIDATION",
        issueImmediately: true,
      },
      adminUser.id
    );
    assert.equal(blockedPendingCa.success, false);

    // Generate DRAFT first covering B, E, F
    const draftGen = await generateCommissionInvoiceCore(
      {
        instituteId: institute.id,
        periodStart: past16Days.toISOString(),
        periodEnd: new Date(now.getTime() + 60_000).toISOString(),
        taxTreatmentMode: "PENDING_CA_VALIDATION",
        issueImmediately: false,
      },
      adminUser.id
    );
    assert.equal(draftGen.success, true);
    cleanup.invoiceIds.push(draftGen.invoiceId);
    assert.equal(draftGen.entryCount, 3);

    // Ensure issueCommissionInvoiceCore blocks issuing while taxTreatmentMode is PENDING_CA_VALIDATION
    const blockedDraftIssue = await issueCommissionInvoiceCore(draftGen.invoiceId, adminUser.id);
    assert.equal(blockedDraftIssue.success, false);

    // Cancel Student F while still in DRAFT -> detaches F cleanly & recalculates DRAFT to 2 entries (zero credit note!)
    const cancelFInDraft = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: redeemF.admissionId,
        reason: "Student F withdrew while B2B invoice was still in DRAFT stage.",
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelFInDraft.success, true);
    assert.equal(cancelFInDraft.creditNoteNumber, null);

    const draftAfterF = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({
      where: { id: draftGen.invoiceId },
      include: { _count: { select: { entries: true } } },
    });
    assert.equal(draftAfterF.status, "DRAFT");
    assert.equal(draftAfterF._count.entries, 2);

    // Concurrent issueCommissionInvoiceCore with CA-validated INTRA_STATE_CGST_SGST (1 succeeds, 1 rejects cleanly)
    const issueRace = await Promise.all([
      issueCommissionInvoiceCore(draftGen.invoiceId, adminUser.id, "INTRA_STATE_CGST_SGST"),
      issueCommissionInvoiceCore(draftGen.invoiceId, adminUser.id, "INTRA_STATE_CGST_SGST"),
    ]);
    assert.equal(issueRace.filter((r) => r.success).length, 1);
    assert.equal(issueRace.filter((r) => !r.success).length, 1);

    const issuedInv = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({
      where: { id: draftGen.invoiceId },
    });
    assert.equal(issuedInv.status, "ISSUED");
    // 2 entries * (3060 + 550.80 GST) = 7221.60
    assert.equal(Number(issuedInv.totalPayableAmount), 7221.6);
    assert.equal(Number(issuedInv.cgstAmount), 550.8);
    assert.equal(Number(issuedInv.sgstAmount), 550.8);

    // Cancel Student E AFTER invoice is ISSUED (unpaid) -> ledger stays INVOICED, original invoice intact, Credit Note APPLIED_TO_INVOICE!
    const cancelEPostIssue = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: redeemE.admissionId,
        reason: "Student E transferred after GST invoice issuance.",
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelEPostIssue.success, true);
    assert.equal(cancelEPostIssue.commissionStatus, "CREDIT_NOTE_ISSUED");
    assert.ok(cancelEPostIssue.creditNoteNumber);

    const [entryEAfter, invAfterE, cnE] = await Promise.all([
      prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { admissionId: redeemE.admissionId } }),
      prisma.batchBuyCommissionInvoice.findUniqueOrThrow({ where: { id: issuedInv.id } }),
      prisma.batchBuyCreditNote.findUniqueOrThrow({
        where: { creditNoteNumber: cancelEPostIssue.creditNoteNumber! },
      }),
    ]);
    assert.equal(entryEAfter.status, "INVOICED");
    assert.equal(Number(invAfterE.totalPayableAmount), 7221.6);
    assert.equal(cnE.status, "APPLIED_TO_INVOICE");
    assert.equal(Number(cnE.appliedToInvoiceBalance), 3610.8);
    assert.equal(Number(cnE.refundPayableToInstitute), 0);

    // Pay remaining collectible balance (3610.80) + test concurrent duplicate UTR guard
    const utrPaid = `UTR-REM-${RUN_TAG.toUpperCase()}-01`;
    const payRace = await Promise.all([
      recordCommissionPaymentCore(
        {
          invoiceId: issuedInv.id,
          amount: 3610.8,
          paymentMode: "NEFT",
          utrOrReference: utrPaid,
        },
        adminUser.id
      ),
      recordCommissionPaymentCore(
        {
          invoiceId: issuedInv.id,
          amount: 3610.8,
          paymentMode: "NEFT",
          utrOrReference: utrPaid,
        },
        adminUser.id
      ),
    ]);
    assert.equal(payRace.filter((r) => r.success).length, 1);
    assert.equal(payRace.filter((r) => !r.success).length, 1);

    const invAfterPay = await prisma.batchBuyCommissionInvoice.findUniqueOrThrow({
      where: { id: issuedInv.id },
    });
    assert.equal(invAfterPay.status, "PAID");
    assert.equal(Number(invAfterPay.amountPaid), 3610.8);

    // Cancel Student B AFTER invoice is PAID -> original PAID invoice & SETTLED ledger preserved, second Credit Note = REFUND_PENDING -> REFUNDED!
    const cancelBPostPay = await cancelOrRefundBatchBuyAdmissionCore(
      {
        admissionId: redeemB.admissionId,
        reason: "Student B medical withdrawal after invoice settlement.",
        directRefundCompleted: true,
      },
      mgrAuth
    );
    assert.equal(cancelBPostPay.success, true);
    assert.equal(cancelBPostPay.commissionStatus, "CREDIT_NOTE_ISSUED");

    const cnB = await prisma.batchBuyCreditNote.findUniqueOrThrow({
      where: { creditNoteNumber: cancelBPostPay.creditNoteNumber! },
    });
    assert.equal(cnB.status, "REFUND_PENDING");
    assert.equal(Number(cnB.refundPayableToInstitute), 3610.8);

    const refundSettle = await settleCreditNoteRefundCore(
      {
        creditNoteId: cnB.id,
        utrOrReference: `UTR-REF-${RUN_TAG.toUpperCase()}-01`,
      },
      adminUser.id
    );
    assert.equal(refundSettle.success, true);
    assert.equal(refundSettle.status, "REFUNDED");
    console.log("  [PASS] 8. CA tax gate, DRAFT recalc, ISSUED/PAID immutable Credit Notes, refund UTR & race guards verified.");

    // -------------------------------------------------------------------------
    // TEST 9: Institute deletion preserves BatchBuyAuditLog via onDelete: SetNull + snapshot
    // -------------------------------------------------------------------------
    const tempInst = await prisma.institute.create({
      data: {
        name: `Temp Audit Delete Inst ${RUN_TAG}`,
        slug: `${RUN_TAG}-del-inst`,
        address: "Audit Preservation Test",
        cityId: city.id,
      },
    });
    cleanup.instituteIds.push(tempInst.id);

    const preservedAudit = await prisma.$transaction(async (tx) =>
      writeBatchBuyAuditLogTx(tx, {
        instituteId: tempInst.id,
        actorUserId: adminUser.id,
        actorRole: "ADMIN",
        action: "PRESERVATION_PROBE",
        entityType: "Institute",
        entityId: tempInst.id,
      })
    );

    await prisma.institute.delete({ where: { id: tempInst.id } });
    const auditAfterDelete = await prisma.batchBuyAuditLog.findUnique({
      where: { id: preservedAudit.id },
    });
    assert.ok(auditAfterDelete, "Audit log must survive parent Institute deletion.");
    assert.equal(auditAfterDelete.instituteId, null);
    assert.equal(auditAfterDelete.instituteIdSnapshot, tempInst.id);
    console.log("  [PASS] 9. Deleting parent Institute preserves BatchBuyAuditLog with instituteIdSnapshot.");

    console.log(`\n[BatchBuy Remediation Real Postgres E2E] ALL 9 LIVE DATABASE SUITES PASSED.\n`);
  } finally {
    // Guaranteed cleanup in foreign-key dependency order
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
      await prisma.admissionRecord.deleteMany({
        where: { id: { in: cleanup.admissionIds } },
      });
    }
    if (cleanup.cohortIds.length > 0) {
      await prisma.admissionVoucher.deleteMany({
        where: { cohortId: { in: cleanup.cohortIds } },
      });
      await prisma.groupOfferDecision.deleteMany({
        where: { cohortId: { in: cleanup.cohortIds } },
      });
      await prisma.cohortOffer.deleteMany({
        where: { cohortId: { in: cleanup.cohortIds } },
      });
      await prisma.groupCohortMember.deleteMany({
        where: { cohortId: { in: cleanup.cohortIds } },
      });
      await prisma.groupAdmissionCohort.deleteMany({
        where: { id: { in: cleanup.cohortIds } },
      });
    }
    if (cleanup.enquiryIds.length > 0) {
      await prisma.instituteEnquiry.deleteMany({
        where: { id: { in: cleanup.enquiryIds } },
      });
    }
    if (cleanup.instituteIds.length > 0) {
      await prisma.instituteBatchBuyAgreement.deleteMany({
        where: { instituteId: { in: cleanup.instituteIds } },
      });
      await prisma.groupDiscountSlab.deleteMany({
        where: { instituteId: { in: cleanup.instituteIds } },
      });
      await prisma.instituteManager.deleteMany({
        where: { instituteId: { in: cleanup.instituteIds } },
      });
    }
    if (cleanup.batchIds.length > 0) {
      await prisma.instituteBatch.deleteMany({
        where: { id: { in: cleanup.batchIds } },
      });
    }
    if (cleanup.instituteIds.length > 0) {
      await prisma.institute.deleteMany({
        where: { id: { in: cleanup.instituteIds } },
      });
    }
    if (cleanup.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: cleanup.userIds } },
      });
    }
    await prisma.$disconnect();
    console.log(`[BatchBuy Remediation Real Postgres E2E] Cleanup complete for ${RUN_TAG}.`);
  }
}

main().catch((err) => {
  console.error("[BatchBuy Remediation Real Postgres E2E] FAILED:", err);
  process.exit(1);
});
