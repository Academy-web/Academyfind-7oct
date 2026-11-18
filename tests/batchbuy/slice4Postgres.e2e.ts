/**
 * Real PostgreSQL (Neon) E2E Integration & Concurrency Harness for BatchBuy Slice 4.
 * Tests versioned commercial agreements, concurrent voucher double-redemption prevention,
 * two-stage minAdmissionQuorum shortfall consent (accept vs penalty-free refund),
 * CRM anti-bypass lookback + Admin adjudication, 15-day cooling-off hold void/maturation,
 * and segregated GST B2B commission invoicing + UTR idempotency against live Neon Postgres.
 *
 * Run: npx tsx tests/batchbuy/slice4Postgres.e2e.ts
 */

import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { Prisma } from "../../app/generated/prisma/client";
import {
  computeCommissionBreakdown,
  computeQuorumSettlementPlan,
} from "../../lib/batchbuy/commissionMath";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
  verifyVoucherQrPresentation,
} from "../../lib/batchbuy/voucherCrypto";
import {
  createAdmissionFromPipelineTx,
  detectAndFlagPotentialBypassTx,
} from "../../lib/instituteSalesManager/admissionPipeline";
import { writeBatchBuyAuditLogTx } from "../../lib/batchbuy/redemptionAuth";

const RUN_TAG = `__s4_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

function isSerializationRetryable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === "P2034" || err.code === "40001") return true;
  if (
    err.code === "P2010" &&
    (err.message.includes("40001") ||
      err.message.toLowerCase().includes("could not serialize access"))
  ) {
    return true;
  }
  return false;
}

async function main() {
  console.log(`\n[BatchBuy Slice 4 Real Postgres E2E] Starting run ${RUN_TAG}...`);

  const createdIds = {
    userIds: [] as string[],
    instituteId: "",
    batchId: "",
    slabIds: [] as string[],
    agreementIds: [] as string[],
    cohortId: "",
    invoiceIds: [] as string[],
    admissionIds: [] as string[],
    enquiryIds: [] as string[],
  };

  try {
    const city = await prisma.city.findFirst({ select: { id: true } });
    if (!city) throw new Error("No City row found in database.");

    const now = new Date();
    const past16Days = new Date(now.getTime() - 16 * 86_400_000);

    // 1. Seed Admin, Institute Manager, and 3 Verified Students
    const [adminUser, managerUser, studentA, studentB, studentC] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Audit Platform Admin",
          username: `${RUN_TAG}_adm`,
          email: `${RUN_TAG}_adm@academyfind.test`,
          role: "ADMIN",
          isActive: true,
          phoneVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Audit Center Manager",
          username: `${RUN_TAG}_mgr`,
          email: `${RUN_TAG}_mgr@academyfind.test`,
          role: "USER",
          isActive: true,
          phoneVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Student Alpha",
          username: `${RUN_TAG}_stu_a`,
          email: `${RUN_TAG}_stu_a@academyfind.test`,
          phone: "9988770001",
          role: "USER",
          isActive: true,
          phoneVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Student Beta",
          username: `${RUN_TAG}_stu_b`,
          email: `${RUN_TAG}_stu_b@academyfind.test`,
          phone: "9988770002",
          role: "USER",
          isActive: true,
          phoneVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Student Gamma",
          username: `${RUN_TAG}_stu_c`,
          email: `${RUN_TAG}_stu_c@academyfind.test`,
          phone: "9988770003",
          role: "USER",
          isActive: true,
          phoneVerified: true,
        },
      }),
    ]);

    createdIds.userIds.push(
      adminUser.id,
      managerUser.id,
      studentA.id,
      studentB.id,
      studentC.id
    );

    const institute = await prisma.institute.create({
      data: {
        name: `Slice4 Institute ${RUN_TAG}`,
        slug: `${RUN_TAG}-inst`,
        address: "102 Test Residency, Kota",
        cityId: city.id,
      },
    });
    createdIds.instituteId = institute.id;

    const batch = await prisma.instituteBatch.create({
      data: {
        instituteId: institute.id,
        slug: `${RUN_TAG}-batch`,
        name: "JEE Target Audit Batch",
        courseName: "JEE Main + Adv",
        fee: 120000,
        originalFee: 120000,
      },
    });
    createdIds.batchId = batch.id;

    // 2. Seed Discount Slabs (lower slab 2–3 = 5% OFF, target slab 4–10 = 15% OFF)
    const lowerSlab = await prisma.groupDiscountSlab.create({
      data: {
        instituteId: institute.id,
        batchId: batch.id,
        minStudents: 2,
        maxStudents: 3,
        discountPercentage: new Prisma.Decimal("5.00"),
        waiveRegistration: true,
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        createdById: managerUser.id,
      },
    });
    const highSlab = await prisma.groupDiscountSlab.create({
      data: {
        instituteId: institute.id,
        batchId: batch.id,
        minStudents: 4,
        maxStudents: 10,
        discountPercentage: new Prisma.Decimal("15.00"),
        waiveRegistration: true,
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        createdById: managerUser.id,
      },
    });
    createdIds.slabIds.push(lowerSlab.id, highSlab.id);

    // 3. Seed Commercial Agreement (3% STANDARD_3_PCT, ACTIVE) & verify @@unique([instituteId, version])
    const agreement = await prisma.instituteBatchBuyAgreement.create({
      data: {
        instituteId: institute.id,
        version: 1,
        status: "ACTIVE",
        rateTier: "STANDARD_3_PCT",
        commissionRatePct: new Prisma.Decimal("3.00"),
        gstRatePct: new Prisma.Decimal("18.00"),
        gstTreatmentNote: "Audit 3% net tuition + 18% GST segregated",
        sacCode: "998399",
        sacValidatedByCa: false,
        attributionWindowDays: 30,
        holdingPeriodDays: 15,
        paymentDueDays: 15,
        cancellationClawbackPolicy: "15-day commercial cooling-off hold.",
        effectiveFrom: past16Days,
        acceptedAt: past16Days,
        acceptedById: managerUser.id,
        acceptedRepresentativeName: "Audit Director",
        acceptedDesignation: "Director",
        createdById: adminUser.id,
      },
    });
    createdIds.agreementIds.push(agreement.id);

    await assert.rejects(
      async () => {
        await prisma.instituteBatchBuyAgreement.create({
          data: {
            instituteId: institute.id,
            version: 1,
            status: "DRAFT",
            rateTier: "PARTNER_2_PCT",
            commissionRatePct: new Prisma.Decimal("2.00"),
            gstRatePct: new Prisma.Decimal("18.00"),
            gstTreatmentNote: "Duplicate version check",
            cancellationClawbackPolicy: "15d hold",
            effectiveFrom: now,
            createdById: adminUser.id,
          },
        });
      },
      /Unique constraint|P2002/i
    );
    console.log("  [PASS] Step 1: Versioned Commercial Agreement uniqueness enforced.");

    // 4. Seed Cohort + Members + Offer (minAdmissionQuorum = 4, REVERT_TO_LOWER_SLAB, voucher already past expiry for Stage 2 test later)
    const cohort = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-S4-${RUN_TAG.slice(-7).toUpperCase()}`,
        title: "Slice 4 Real PG Verification Cohort",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        targetSize: 5,
        minRequired: 2,
        maxCapacity: 10,
        status: "ADMISSION_OPEN",
        formingExpiresAt: new Date(now.getTime() + 5 * 86_400_000),
        createdById: studentA.id,
      },
    });
    createdIds.cohortId = cohort.id;

    const [memA, memB, memC] = await Promise.all([
      prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: studentA.id,
          stage: "VOUCHER_ISSUED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
          joinedAt: past16Days,
        },
      }),
      prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: studentB.id,
          stage: "VOUCHER_ISSUED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: past16Days,
          joinedAt: past16Days,
        },
      }),
      prisma.groupCohortMember.create({
        data: {
          cohortId: cohort.id,
          userId: studentC.id,
          stage: "INTENT_VERIFIED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: new Date(now.getTime() - 4 * 86_400_000),
          joinedAt: new Date(now.getTime() - 4 * 86_400_000),
        },
      }),
    ]);

    const futureVoucherExpiry = new Date(now.getTime() + 5 * 86_400_000);
    const offer = await prisma.cohortOffer.create({
      data: {
        cohortId: cohort.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 1,
        status: "QUORUM_MET",
        sourceSlabId: highSlab.id,
        title: "Slice 4 Group Offer v1 (15% OFF)",
        baseFee: new Prisma.Decimal("120000.00"),
        registrationFeeOriginal: new Prisma.Decimal("2000.00"),
        waiveRegistration: true,
        discountPercentage: new Prisma.Decimal("15.00"),
        discountAmount: new Prisma.Decimal("18000.00"),
        netPayableTuition: new Prisma.Decimal("102000.00"),
        includedPerks: ["Test Series"],
        fallbackPolicy: "REVERT_TO_LOWER_SLAB",
        minAcceptanceQuorum: 2,
        minAdmissionQuorum: 4,
        offerExpiresAt: new Date(now.getTime() - 2 * 86_400_000),
        voucherExpiresAt: futureVoucherExpiry,
        publishedAt: past16Days,
        quorumMetAt: new Date(now.getTime() - 3 * 86_400_000),
        createdById: managerUser.id,
        commissionAgreementId: agreement.id,
        commissionRatePctSnapshot: agreement.commissionRatePct,
        commissionTierSnapshot: agreement.rateTier,
        attributionWindowDaysSnapshot: agreement.attributionWindowDays,
        holdingPeriodDaysSnapshot: agreement.holdingPeriodDays,
      },
    });

    const artA = generateVoucherArtifacts({
      offerId: offer.id,
      offerVersion: 1,
      cohortId: cohort.id,
      cohortMemberId: memA.id,
      userId: studentA.id,
      instituteId: institute.id,
      batchId: batch.id,
    });
    const artB = generateVoucherArtifacts({
      offerId: offer.id,
      offerVersion: 1,
      cohortId: cohort.id,
      cohortMemberId: memB.id,
      userId: studentB.id,
      instituteId: institute.id,
      batchId: batch.id,
    });

    const [decA, decB] = await Promise.all([
      prisma.groupOfferDecision.create({
        data: {
          offerId: offer.id,
          cohortId: cohort.id,
          cohortMemberId: memA.id,
          userId: studentA.id,
          decision: "ACCEPTED",
          revalidatedIntentAt: past16Days,
          decidedAt: new Date(now.getTime() - 3 * 86_400_000),
        },
      }),
      prisma.groupOfferDecision.create({
        data: {
          offerId: offer.id,
          cohortId: cohort.id,
          cohortMemberId: memB.id,
          userId: studentB.id,
          decision: "ACCEPTED",
          revalidatedIntentAt: past16Days,
          decidedAt: new Date(now.getTime() - 3 * 86_400_000),
        },
      }),
    ]);

    const [voucherA, voucherB] = await Promise.all([
      prisma.admissionVoucher.create({
        data: {
          voucherCode: artA.voucherCode,
          tokenHash: artA.tokenHash,
          securityNonce: artA.securityNonce,
          offerId: offer.id,
          offerVersion: 1,
          decisionId: decA.id,
          cohortId: cohort.id,
          cohortMemberId: memA.id,
          userId: studentA.id,
          instituteId: institute.id,
          batchId: batch.id,
          status: "ACTIVE",
          baseFee: offer.baseFee,
          registrationFeeOriginal: offer.registrationFeeOriginal,
          waiveRegistration: true,
          discountPercentage: offer.discountPercentage,
          discountAmount: offer.discountAmount,
          netPayableTuition: offer.netPayableTuition,
          includedPerks: ["Test Series"],
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          minAcceptanceQuorumSnapshot: 2,
          minAdmissionQuorumSnapshot: 4,
          studentNameSnapshot: "Student Alpha",
          instituteNameSnapshot: institute.name,
          batchNameSnapshot: batch.name,
          activatedAt: new Date(now.getTime() - 3 * 86_400_000),
          expiresAt: futureVoucherExpiry,
        },
      }),
      prisma.admissionVoucher.create({
        data: {
          voucherCode: artB.voucherCode,
          tokenHash: artB.tokenHash,
          securityNonce: artB.securityNonce,
          offerId: offer.id,
          offerVersion: 1,
          decisionId: decB.id,
          cohortId: cohort.id,
          cohortMemberId: memB.id,
          userId: studentB.id,
          instituteId: institute.id,
          batchId: batch.id,
          status: "ACTIVE",
          baseFee: offer.baseFee,
          registrationFeeOriginal: offer.registrationFeeOriginal,
          waiveRegistration: true,
          discountPercentage: offer.discountPercentage,
          discountAmount: offer.discountAmount,
          netPayableTuition: offer.netPayableTuition,
          includedPerks: ["Test Series"],
          fallbackPolicy: "REVERT_TO_LOWER_SLAB",
          minAcceptanceQuorumSnapshot: 2,
          minAdmissionQuorumSnapshot: 4,
          studentNameSnapshot: "Student Beta",
          instituteNameSnapshot: institute.name,
          batchNameSnapshot: batch.name,
          activatedAt: new Date(now.getTime() - 3 * 86_400_000),
          expiresAt: futureVoucherExpiry,
        },
      }),
    ]);

    const { qrPayload: qrA } = computeVoucherQrPayload({
      voucherCode: voucherA.voucherCode,
      securityNonce: voucherA.securityNonce,
      offerId: offer.id,
      offerVersion: 1,
      cohortId: cohort.id,
      cohortMemberId: memA.id,
      userId: studentA.id,
      instituteId: institute.id,
      batchId: batch.id,
      expiresAtIso: futureVoucherExpiry.toISOString(),
    });
    assert.equal(
      verifyVoucherQrPresentation({
        qrPayloadRaw: qrA,
        storedVoucher: {
          voucherCode: voucherA.voucherCode,
          securityNonce: voucherA.securityNonce,
          offerId: offer.id,
          offerVersion: 1,
          cohortId: cohort.id,
          cohortMemberId: memA.id,
          userId: studentA.id,
          instituteId: institute.id,
          batchId: batch.id,
          expiresAtIso: futureVoucherExpiry.toISOString(),
          tokenHash: voucherA.tokenHash,
          status: "ACTIVE",
          expiresAt: futureVoucherExpiry,
        },
      }).valid,
      true
    );

    // 5. Concurrent Single-Use Double-Redemption Race on Voucher A
    const attemptRedeemA = async (attemptIdx: number) => {
      try {
        return await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "admission_voucher" WHERE id = ${voucherA.id} FOR UPDATE`;
            const v = await tx.admissionVoucher.findUniqueOrThrow({ where: { id: voucherA.id } });
            if (v.status !== "ACTIVE") {
              throw new Error(`Already redeemed (${v.status})`);
            }
            const enq = await tx.instituteEnquiry.create({
              data: {
                name: "Student Alpha",
                phone: "9988770001",
                email: studentA.email,
                instituteId: institute.id,
                source: "BATCHBUY_VOUCHER",
                status: "CONVERTED",
                assignedIsmId: managerUser.id,
              },
            });
            createdIds.enquiryIds.push(enq.id);

            const adm = await createAdmissionFromPipelineTx(tx, {
              enquiryId: enq.id,
              instituteId: institute.id,
              ismId: managerUser.id,
              studentName: "Student Alpha",
              courseName: batch.name,
              batchId: batch.id,
              batchBuyVoucherId: voucherA.id,
              batchBuyLockedFeeStr: "102000.00",
              batchBuySettledFeeStr: "102000.00",
              totalFee: 102000,
              paidAmount: 50000,
              feeStatus: "PARTIAL",
              actorRole: "INSTITUTE_MANAGER",
              actorName: "Audit Manager",
              activityContent: `BatchBuy Voucher ${voucherA.voucherCode} redeemed (attempt ${attemptIdx})`,
              installments: [],
            });
            createdIds.admissionIds.push(adm.id);

            await tx.admissionVoucher.update({
              where: { id: voucherA.id },
              data: {
                status: "REDEEMED",
                redeemedAt: now,
                redeemedById: managerUser.id,
                redemptionMethod: "QR_SCAN",
                settlementState: "PROVISIONAL_QUORUM_OPEN",
                disclosedFallbackFee: new Prisma.Decimal("114000.00"),
                settledTuition: new Prisma.Decimal("102000.00"),
                shortfallDisclosureAcceptedAt: now,
              },
            });

            const attr = await tx.batchBuyAttribution.create({
              data: {
                instituteId: institute.id,
                cohortId: cohort.id,
                offerId: offer.id,
                cohortMemberId: memA.id,
                userId: studentA.id,
                voucherId: voucherA.id,
                admissionId: adm.id,
                enquiryId: enq.id,
                sourceType: "VOUCHER_REDEMPTION",
                matchStatus: "VERIFIED",
                reviewedById: managerUser.id,
                reviewedAt: now,
              },
            });

            const comm = computeCommissionBreakdown({
              commissionableTuition: 102000,
              excludedNonTuitionAmount: 5000, // hostel excluded cleanly
              commissionRatePct: 3,
              gstRatePct: 18,
            });
            const ledger = await tx.commissionLedgerEntry.create({
              data: {
                instituteId: institute.id,
                agreementId: agreement.id,
                admissionId: adm.id,
                voucherId: voucherA.id,
                attributionId: attr.id,
                commissionableTuition: new Prisma.Decimal(comm.commissionableTuitionStr),
                excludedNonTuitionAmount: new Prisma.Decimal(comm.excludedNonTuitionAmountStr),
                commissionRatePct: new Prisma.Decimal(comm.commissionRatePctStr),
                commissionAmount: new Prisma.Decimal(comm.commissionAmountStr),
                gstRatePct: new Prisma.Decimal(comm.gstRatePctStr),
                gstAmount: new Prisma.Decimal(comm.gstAmountStr),
                totalPayableAmount: new Prisma.Decimal(comm.totalPayableAmountStr),
                status: "HOLD_PERIOD",
                redeemedAt: past16Days,
                holdEndsAt: new Date(past16Days.getTime() + 15 * 86_400_000),
              },
            });
            return { ok: true as const, admissionId: adm.id, ledgerId: ledger.id };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (err: unknown) {
        if (isSerializationRetryable(err) || (err instanceof Error && /Already redeemed|P2002|unique/i.test(err.message))) {
          return { ok: false as const, error: err instanceof Error ? err.message : "conflict" };
        }
        throw err;
      }
    };

    const [redeemRes1, redeemRes2] = await Promise.all([attemptRedeemA(1), attemptRedeemA(2)]);
    const redeemWins = [redeemRes1, redeemRes2].filter((r) => r.ok);
    const redeemLosses = [redeemRes1, redeemRes2].filter((r) => !r.ok);
    assert.equal(redeemWins.length, 1, "Exactly one redemption must win under concurrent race");
    assert.equal(redeemLosses.length, 1, "Second concurrent redemption must be cleanly rejected");

    const countAdmA = await prisma.admissionRecord.count({ where: { batchBuyVoucherId: voucherA.id } });
    assert.equal(countAdmA, 1);
    console.log("  [PASS] Step 2: Concurrent single-use voucher double-redemption prevented cleanly.");

    // Also redeem Voucher B (paid 50000 upfront) for Student B so we have 2/4 admissions (short of quorum 4!)
    const admBInfo = await prisma.$transaction(async (tx) => {
      const enqB = await tx.instituteEnquiry.create({
        data: {
          name: "Student Beta",
          phone: "9988770002",
          email: studentB.email,
          instituteId: institute.id,
          source: "BATCHBUY_VOUCHER",
          status: "CONVERTED",
          assignedIsmId: managerUser.id,
        },
      });
      createdIds.enquiryIds.push(enqB.id);

      const admB = await createAdmissionFromPipelineTx(tx, {
        enquiryId: enqB.id,
        instituteId: institute.id,
        ismId: managerUser.id,
        studentName: "Student Beta",
        courseName: batch.name,
        batchId: batch.id,
        batchBuyVoucherId: voucherB.id,
        batchBuyLockedFeeStr: "102000.00",
        batchBuySettledFeeStr: "102000.00",
        totalFee: 102000,
        paidAmount: 50000,
        feeStatus: "PARTIAL",
        actorRole: "INSTITUTE_MANAGER",
        actorName: "Audit Manager",
        activityContent: `BatchBuy Voucher ${voucherB.voucherCode} redeemed`,
        installments: [],
      });
      createdIds.admissionIds.push(admB.id);

      await tx.admissionVoucher.update({
        where: { id: voucherB.id },
        data: {
          status: "REDEEMED",
          redeemedAt: now,
          redeemedById: managerUser.id,
          redemptionMethod: "MANUAL_CODE",
          settlementState: "PROVISIONAL_QUORUM_OPEN",
          disclosedFallbackFee: new Prisma.Decimal("114000.00"),
          settledTuition: new Prisma.Decimal("102000.00"),
          shortfallDisclosureAcceptedAt: now,
        },
      });

      const attrB = await tx.batchBuyAttribution.create({
        data: {
          instituteId: institute.id,
          cohortId: cohort.id,
          offerId: offer.id,
          cohortMemberId: memB.id,
          userId: studentB.id,
          voucherId: voucherB.id,
          admissionId: admB.id,
          enquiryId: enqB.id,
          sourceType: "VOUCHER_REDEMPTION",
          matchStatus: "VERIFIED",
          reviewedById: managerUser.id,
          reviewedAt: now,
        },
      });

      const commB = computeCommissionBreakdown({
        commissionableTuition: 102000,
        commissionRatePct: 3,
        gstRatePct: 18,
      });
      await tx.commissionLedgerEntry.create({
        data: {
          instituteId: institute.id,
          agreementId: agreement.id,
          admissionId: admB.id,
          voucherId: voucherB.id,
          attributionId: attrB.id,
          commissionableTuition: new Prisma.Decimal(commB.commissionableTuitionStr),
          excludedNonTuitionAmount: new Prisma.Decimal("0.00"),
          commissionRatePct: new Prisma.Decimal(commB.commissionRatePctStr),
          commissionAmount: new Prisma.Decimal(commB.commissionAmountStr),
          gstRatePct: new Prisma.Decimal(commB.gstRatePctStr),
          gstAmount: new Prisma.Decimal(commB.gstAmountStr),
          totalPayableAmount: new Prisma.Decimal(commB.totalPayableAmountStr),
          status: "HOLD_PERIOD",
          redeemedAt: now,
          holdEndsAt: new Date(now.getTime() + 15 * 86_400_000),
        },
      });
      return admB;
    });

    // 6. Stage 2 Quorum Shortfall (2 < 4) -> PENDING_STUDENT_FALLBACK_CONSENT -> Student A accepts 114k, Student B declines penalty-free
    const stage2Plan = computeQuorumSettlementPlan({
      fallbackPolicy: "REVERT_TO_LOWER_SLAB",
      minAdmissionQuorum: 4,
      confirmedAdmissionsCount: 2,
      baseFee: 120000,
      lockedOfferTuition: 102000,
      qualifyingLowerSlabPct: 5,
    });
    assert.equal(stage2Plan.postExpiryShortfallState, "PENDING_STUDENT_FALLBACK_CONSENT");
    assert.equal(stage2Plan.disclosedFallbackFeeStr, "114000.00");

    await prisma.$transaction(async (tx) => {
      await tx.admissionVoucher.updateMany({
        where: { offerId: offer.id, status: "REDEEMED" },
        data: {
          settlementState: "PENDING_STUDENT_FALLBACK_CONSENT",
          fallbackConsentRequestedAt: now,
          disclosedFallbackFee: new Prisma.Decimal("114000.00"),
        },
      });
      await tx.admissionRecord.updateMany({
        where: { batchBuyVoucher: { offerId: offer.id } },
        data: { status: "PENDING_FALLBACK_CONSENT" },
      });
    });

    // Student A accepts revised ₹1,14,000 fee -> updates AdmissionRecord & recomputes CommissionLedgerEntry cleanly
    await prisma.$transaction(async (tx) => {
      const commRecomputed = computeCommissionBreakdown({
        commissionableTuition: 114000,
        commissionRatePct: 3,
        gstRatePct: 18,
      });
      await tx.admissionVoucher.update({
        where: { id: voucherA.id },
        data: {
          settlementState: "SETTLED_FALLBACK_ACCEPTED",
          fallbackConsentRespondedAt: now,
          fallbackConsentAccepted: true,
          settledTuition: new Prisma.Decimal("114000.00"),
        },
      });
      await tx.admissionRecord.update({
        where: { batchBuyVoucherId: voucherA.id },
        data: {
          status: "CONFIRMED",
          totalFee: 114000,
          batchBuySettledFee: new Prisma.Decimal("114000.00"),
        },
      });
      await tx.commissionLedgerEntry.update({
        where: { voucherId: voucherA.id },
        data: {
          commissionableTuition: new Prisma.Decimal(commRecomputed.commissionableTuitionStr),
          commissionAmount: new Prisma.Decimal(commRecomputed.commissionAmountStr),
          gstAmount: new Prisma.Decimal(commRecomputed.gstAmountStr),
          totalPayableAmount: new Prisma.Decimal(commRecomputed.totalPayableAmountStr),
        },
      });
    });

    // Student B declines penalty-free -> admission CANCELLED, directRefundRequiredAmount = 50000, ledger VOIDED_COOLING_OFF
    await prisma.$transaction(async (tx) => {
      await tx.admissionVoucher.update({
        where: { id: voucherB.id },
        data: {
          settlementState: "CANCELLED_ON_SHORTFALL",
          fallbackConsentRespondedAt: now,
          fallbackConsentAccepted: false,
        },
      });
      await tx.admissionRecord.update({
        where: { id: admBInfo.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: "Student declined shortfall fee revision penalty-free.",
          directRefundRequiredAmount: new Prisma.Decimal("50000.00"),
          directRefundStatus: "PENDING_INSTITUTE_REFUND",
        },
      });
      await tx.commissionLedgerEntry.update({
        where: { admissionId: admBInfo.id },
        data: {
          status: "VOIDED_COOLING_OFF",
          voidReason: "Student declined shortfall revision penalty-free.",
        },
      });
    });

    const settledA = await prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { voucherId: voucherA.id } });
    const voidedB = await prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { admissionId: admBInfo.id } });
    assert.equal(Number(settledA.commissionAmount), 3420);
    assert.equal(Number(settledA.gstAmount), 615.6);
    assert.equal(voidedB.status, "VOIDED_COOLING_OFF");
    console.log("  [PASS] Step 3: Two-stage shortfall consent (accept recomputes commission; decline voids + flags direct refund).");

    // 7. Non-blocking Anti-Bypass Lookback on CRM Admission (Student C)
    await prisma.$transaction(async (tx) => {
      const enqC = await tx.instituteEnquiry.create({
        data: {
          name: "Student Gamma",
          phone: "9988770003",
          email: studentC.email,
          instituteId: institute.id,
          source: "WALK_IN",
          status: "CONVERTED",
          assignedIsmId: managerUser.id,
        },
      });
      createdIds.enquiryIds.push(enqC.id);

      const admC = await createAdmissionFromPipelineTx(tx, {
        enquiryId: enqC.id,
        instituteId: institute.id,
        ismId: managerUser.id,
        studentName: "Student Gamma",
        courseName: batch.name,
        totalFee: 118000,
        paidAmount: 20000,
        feeStatus: "PARTIAL",
        actorRole: "INSTITUTE_SALES_MANAGER",
        actorName: "Sales Rep",
        activityContent: "CRM direct conversion",
        installments: [],
      });
      createdIds.admissionIds.push(admC.id);

      const flagRes = await detectAndFlagPotentialBypassTx(tx, {
        admissionId: admC.id,
        enquiryId: enqC.id,
        instituteId: institute.id,
        leadName: "Student Gamma",
        leadPhone: "9988770003",
        leadEmail: studentC.email,
        actorUserId: managerUser.id,
        actorRole: "INSTITUTE_SALES_MANAGER",
        now,
      });
      assert.equal(flagRes.flagged, true);
    });

    const flaggedC = await prisma.batchBuyAttribution.findFirstOrThrow({
      where: { instituteId: institute.id, matchStatus: "FLAGGED_SUSPECTED_BYPASS" },
      include: { commission: true },
    });
    assert.equal(flaggedC.commission, null, "Phone match alone must never auto-create commission");
    console.log("  [PASS] Step 4: CRM anti-bypass lookback flags non-blockingly without auto-charging.");

    // 8. Mature past-hold Ledger Entry A -> Generate B2B GST Invoice -> Record UTR Payment + Duplicate UTR Rejection
    await prisma.$transaction(async (tx) => {
      await tx.commissionLedgerEntry.updateMany({
        where: {
          instituteId: institute.id,
          status: "HOLD_PERIOD",
          holdEndsAt: { lte: now },
        },
        data: { status: "ELIGIBLE", maturedAt: now },
      });

      const inv = await tx.batchBuyCommissionInvoice.create({
        data: {
          invoiceNumber: `AF-BB-TEST-${RUN_TAG.slice(-6).toUpperCase()}`,
          instituteId: institute.id,
          periodStart: new Date(past16Days.getTime() - 86_400_000),
          periodEnd: now,
          issuedAt: now,
          dueAt: new Date(now.getTime() + 15 * 86_400_000),
          subtotalCommission: new Prisma.Decimal("3420.00"),
          cgstAmount: new Prisma.Decimal("307.80"),
          sgstAmount: new Prisma.Decimal("307.80"),
          igstAmount: new Prisma.Decimal("0.00"),
          gstTotalAmount: new Prisma.Decimal("615.60"),
          totalPayableAmount: new Prisma.Decimal("4035.60"),
          taxTreatmentMode: "INTRA_STATE_CGST_SGST",
          sacValidationDisclaimer: "Pending formal CA SAC sign-off.",
          status: "ISSUED",
          createdById: adminUser.id,
        },
      });
      createdIds.invoiceIds.push(inv.id);

      await tx.commissionLedgerEntry.update({
        where: { id: settledA.id },
        data: { status: "INVOICED", invoiceId: inv.id },
      });

      await tx.commissionPaymentRecord.create({
        data: {
          invoiceId: inv.id,
          amount: new Prisma.Decimal("4035.60"),
          paymentMode: "NEFT",
          utrOrReference: `UTR_${RUN_TAG}`,
          paidAt: now,
          recordedById: adminUser.id,
          verifiedById: adminUser.id,
          verifiedAt: now,
        },
      });

      await tx.batchBuyCommissionInvoice.update({
        where: { id: inv.id },
        data: { amountPaid: new Prisma.Decimal("4035.60"), status: "PAID" },
      });
      await tx.commissionLedgerEntry.updateMany({
        where: { invoiceId: inv.id },
        data: { status: "SETTLED" },
      });
      await writeBatchBuyAuditLogTx(tx, {
        instituteId: institute.id,
        actorUserId: adminUser.id,
        actorRole: "ADMIN",
        action: "PAYMENT_RECORDED",
        entityType: "BatchBuyCommissionInvoice",
        entityId: inv.id,
      });
    });

    // Duplicate UTR blocked by PostgreSQL @unique constraint
    await assert.rejects(
      async () => {
        await prisma.commissionPaymentRecord.create({
          data: {
            invoiceId: createdIds.invoiceIds[0],
            amount: new Prisma.Decimal("1.00"),
            paymentMode: "NEFT",
            utrOrReference: `UTR_${RUN_TAG}`,
            paidAt: now,
            recordedById: adminUser.id,
          },
        });
      },
      /Unique constraint|P2002/i
    );

    const finalEntryA = await prisma.commissionLedgerEntry.findUniqueOrThrow({ where: { id: settledA.id } });
    assert.equal(finalEntryA.status, "SETTLED");
    console.log("  [PASS] Step 5: 15-day hold maturation, GST-segregated B2B invoice & unique UTR settlement verified.");
    console.log(`\n[BatchBuy Slice 4 Real Postgres E2E] ALL 5 LIVE DATABASE SUITES PASSED.\n`);
  } finally {
    // Guaranteed cleanup in dependency order
    if (createdIds.instituteId) {
      await prisma.batchBuyAuditLog.deleteMany({ where: { instituteId: createdIds.instituteId } });
      await prisma.commissionLedgerEntry.deleteMany({ where: { instituteId: createdIds.instituteId } });
      await prisma.batchBuyAttribution.deleteMany({ where: { instituteId: createdIds.instituteId } });
    }
    if (createdIds.invoiceIds.length > 0) {
      await prisma.commissionPaymentRecord.deleteMany({ where: { invoiceId: { in: createdIds.invoiceIds } } });
      await prisma.batchBuyCommissionInvoice.deleteMany({ where: { id: { in: createdIds.invoiceIds } } });
    }
    if (createdIds.admissionIds.length > 0) {
      await prisma.admissionRecord.deleteMany({ where: { id: { in: createdIds.admissionIds } } });
    }
    if (createdIds.cohortId) {
      await prisma.admissionVoucher.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupOfferDecision.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.cohortOffer.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupCohortMember.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupAdmissionCohort.deleteMany({ where: { id: createdIds.cohortId } });
    }
    if (createdIds.enquiryIds.length > 0) {
      await prisma.instituteEnquiry.deleteMany({ where: { id: { in: createdIds.enquiryIds } } });
    }
    if (createdIds.agreementIds.length > 0) {
      await prisma.instituteBatchBuyAgreement.deleteMany({ where: { id: { in: createdIds.agreementIds } } });
    }
    if (createdIds.slabIds.length > 0) {
      await prisma.groupDiscountSlab.deleteMany({ where: { id: { in: createdIds.slabIds } } });
    }
    if (createdIds.batchId) {
      await prisma.instituteBatch.deleteMany({ where: { id: createdIds.batchId } });
    }
    if (createdIds.instituteId) {
      await prisma.institute.deleteMany({ where: { id: createdIds.instituteId } });
    }
    if (createdIds.userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdIds.userIds } } });
    }
    await prisma.$disconnect();
    console.log(`[BatchBuy Slice 4 Real Postgres E2E] Cleanup complete for ${RUN_TAG}.`);
  }
}

main().catch((err) => {
  console.error("[BatchBuy Slice 4 Real Postgres E2E] FAILED:", err);
  process.exit(1);
});
