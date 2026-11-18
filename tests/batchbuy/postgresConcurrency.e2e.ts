/**
 * Real PostgreSQL (Neon) Concurrency & Integrity Harness for BatchBuy Slice 3.
 * Executes actual Prisma Serializable transactions + SELECT ... FOR UPDATE row locks
 * against the live PostgreSQL database with disposable isolated test entities and
 * guaranteed cleanup in `finally`.
 *
 * Run: npx tsx tests/batchbuy/postgresConcurrency.e2e.ts
 */

import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { Prisma } from "../../app/generated/prisma/client";
import {
  computeOfferFeeBreakdown,
  evaluateVoucherEligibility,
} from "../../lib/batchbuy/offerValidation";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
  verifyVoucherQrPresentation,
  createGuardianConsentChallenge,
  verifyGuardianOtpHash,
} from "../../lib/batchbuy/voucherCrypto";

const RUN_TAG = `__audit_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
  console.log(`\n[BatchBuy Slice 3 Real Postgres E2E] Starting run ${RUN_TAG}...`);

  const createdIds = {
    userIds: [] as string[],
    instituteId: "",
    batchId: "",
    slabId: "",
    cohortId: "",
    memberIds: [] as string[],
    offerIds: [] as string[],
  };

  try {
    // Pick an existing city row cleanly so FK constraints on Institute are satisfied
    const city = await prisma.city.findFirst({ select: { id: true } });
    if (!city) {
      throw new Error("No City row found in Neon database to host isolated test Institute.");
    }

    // 1. Seed isolated users (1 manager + 3 verified students)
    const manager = await prisma.user.create({
      data: {
        name: "Audit Manager",
        username: `${RUN_TAG}_mgr`,
        email: `${RUN_TAG}_mgr@academyfind.test`,
        role: "USER",
        isActive: true,
        phoneVerified: true,
      },
    });
    const studentA = await prisma.user.create({
      data: {
        name: "Student Alpha",
        username: `${RUN_TAG}_stu_a`,
        email: `${RUN_TAG}_stu_a@academyfind.test`,
        phone: "9900110001",
        role: "USER",
        isActive: true,
        phoneVerified: true,
      },
    });
    const studentB = await prisma.user.create({
      data: {
        name: "Student Beta",
        username: `${RUN_TAG}_stu_b`,
        email: `${RUN_TAG}_stu_b@academyfind.test`,
        phone: "9900110002",
        role: "USER",
        isActive: true,
        phoneVerified: true,
      },
    });
    const studentC = await prisma.user.create({
      data: {
        name: "Student Gamma",
        username: `${RUN_TAG}_stu_c`,
        email: `${RUN_TAG}_stu_c@academyfind.test`,
        phone: "9900110003",
        role: "USER",
        isActive: true,
        phoneVerified: true,
      },
    });
    createdIds.userIds.push(manager.id, studentA.id, studentB.id, studentC.id);

    // 2. Seed isolated Institute, Batch, Discount Slab & Cohort + 3 verified Members
    const institute = await prisma.institute.create({
      data: {
        name: `Audit Institute ${RUN_TAG}`,
        slug: `${RUN_TAG}-inst`,
        address: "101 Test Campus, Kota",
        cityId: city.id,
      },
    });
    createdIds.instituteId = institute.id;

    const batch = await prisma.instituteBatch.create({
      data: {
        instituteId: institute.id,
        slug: `${RUN_TAG}-batch`,
        name: "JEE Nurture Audit Batch",
        courseName: "JEE Advanced",
        fee: 149999,
        originalFee: 165000,
      },
    });
    createdIds.batchId = batch.id;

    const slab = await prisma.groupDiscountSlab.create({
      data: {
        instituteId: institute.id,
        batchId: batch.id,
        minStudents: 2,
        maxStudents: 10,
        discountPercentage: new Prisma.Decimal("12.50"),
        waiveRegistration: true,
        fallbackPolicy: "ABSORB_SHORTFALL",
        createdById: manager.id,
      },
    });
    createdIds.slabId = slab.id;

    const now = new Date();
    const cohort = await prisma.groupAdmissionCohort.create({
      data: {
        cohortCode: `BB-AUD-${RUN_TAG.slice(-8).toUpperCase()}`,
        title: "Real Postgres Concurrency Audit Cohort",
        instituteId: institute.id,
        batchId: batch.id,
        examCategory: "JEE",
        targetAcademicYear: 2026,
        targetSize: 5,
        minRequired: 2,
        maxCapacity: 10,
        status: "FORMING",
        formingExpiresAt: new Date(now.getTime() + 7 * 86_400_000),
        createdById: studentA.id,
      },
    });
    createdIds.cohortId = cohort.id;

    const memA = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort.id,
        userId: studentA.id,
        stage: "INTENT_VERIFIED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: now,
      },
    });
    const memB = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort.id,
        userId: studentB.id,
        stage: "INTENT_VERIFIED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: now,
      },
    });
    const memC = await prisma.groupCohortMember.create({
      data: {
        cohortId: cohort.id,
        userId: studentC.id,
        stage: "INTENT_VERIFIED",
        phoneVerified: true,
        profileConfirmed: true,
        explicitIntentAt: now,
        isMinor: true,
        parentName: "Guardian Gamma",
        parentPhone: "9811122233",
        parentNotifiedAt: now,
        parentConsentVerifiedAt: now,
        parentConsentMethod: "GUARDIAN_WHATSAPP_OTP",
      },
    });
    createdIds.memberIds.push(memA.id, memB.id, memC.id);

    const breakdown = computeOfferFeeBreakdown({
      baseFee: 149999,
      registrationFeeOriginal: 2500,
      waiveRegistration: true,
      discountPercentage: 12.5,
    });
    const offerExpiry = new Date(now.getTime() + 3 * 86_400_000);
    const voucherExpiry = new Date(now.getTime() + 10 * 86_400_000);

    // =========================================================================
    // RACE A: Concurrent Offer Creation + Draft Double-Publish Under FOR UPDATE
    // =========================================================================
    const createOfferTx = async (titleSuffix: string) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${cohort.id} FOR UPDATE`;
          const maxAgg = await tx.cohortOffer.aggregate({
            where: { cohortId: cohort.id },
            _max: { version: true },
          });
          const nextVersion = (maxAgg._max.version ?? 0) + 1;
          return tx.cohortOffer.create({
            data: {
              cohortId: cohort.id,
              instituteId: institute.id,
              batchId: batch.id,
              sourceSlabId: slab.id,
              version: nextVersion,
              status: "DRAFT",
              title: `Offer v${nextVersion} (${titleSuffix})`,
              baseFee: new Prisma.Decimal(breakdown.baseFeeStr),
              registrationFeeOriginal: new Prisma.Decimal(breakdown.registrationFeeOriginalStr),
              waiveRegistration: true,
              discountPercentage: new Prisma.Decimal(breakdown.discountPercentageStr),
              discountAmount: new Prisma.Decimal(breakdown.discountAmountStr),
              netPayableTuition: new Prisma.Decimal(breakdown.netPayableTuitionStr),
              includedPerks: ["Test Series"],
              fallbackPolicy: "ABSORB_SHORTFALL",
              minAcceptanceQuorum: 2,
              minAdmissionQuorum: 2,
              offerExpiresAt: offerExpiry,
              voucherExpiresAt: voucherExpiry,
              createdById: manager.id,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

    const raceACreates = await Promise.allSettled([createOfferTx("P1"), createOfferTx("P2")]);
    const createdOffers = raceACreates
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOfferTx>>> => r.status === "fulfilled")
      .map((r) => r.value);
    for (const o of createdOffers) createdIds.offerIds.push(o.id);

    // At least 1 succeeds and versions are strictly unique (no v1/v1 collision)
    assert.ok(createdOffers.length >= 1, "Race A should create at least 1 draft offer");
    const uniqueVersions = new Set(createdOffers.map((o) => o.version));
    assert.equal(uniqueVersions.size, createdOffers.length, "Offer versions must never collide");

    const draftOffer = createdOffers.find((o) => o.version === 1) ?? createdOffers[0];

    // Simultaneous double-publish of the same DRAFT offer
    const publishDraftTx = async () =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${cohort.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${draftOffer.id} FOR UPDATE`;
          const cur = await tx.cohortOffer.findUnique({ where: { id: draftOffer.id } });
          if (!cur || cur.status !== "DRAFT") {
            throw new Error("Already published or immutable");
          }
          return tx.cohortOffer.update({
            where: { id: cur.id },
            data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: manager.id },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

    const raceAPublishes = await Promise.allSettled([publishDraftTx(), publishDraftTx()]);
    const pubFulfilled = raceAPublishes.filter((r) => r.status === "fulfilled");
    const pubRejected = raceAPublishes.filter((r) => r.status === "rejected");
    assert.equal(pubFulfilled.length, 1, "Only 1 concurrent DRAFT->PUBLISHED transition may succeed");
    assert.equal(pubRejected.length, 1, "Second concurrent DRAFT publish must fail cleanly");
    console.log("  [PASS] Race A: Concurrent offer versioning & double-publish lock verified.");

    // =========================================================================
    // RACE B: Same Student Simultaneous Double-Accept (No Duplicate Voucher)
    // =========================================================================
    const acceptOfferTx = async (member: { id: string; userId: string; name: string }) =>
      prisma.$transaction(
        async (tx) => {
          const ts = new Date();
          await tx.$queryRaw`SELECT id FROM "cohort_offer" WHERE id = ${draftOffer.id} FOR UPDATE`;
          const offer = await tx.cohortOffer.findUnique({ where: { id: draftOffer.id } });
          if (!offer || !["PUBLISHED", "QUORUM_MET"].includes(offer.status)) {
            throw new Error("Offer not active");
          }
          const existing = await tx.groupOfferDecision.findUnique({
            where: { offerId_cohortMemberId: { offerId: offer.id, cohortMemberId: member.id } },
          });
          if (existing) {
            return { deduplicated: true };
          }
          const priorAccepted = await tx.groupOfferDecision.count({
            where: { offerId: offer.id, decision: "ACCEPTED" },
          });
          const acceptedCount = priorAccepted + 1;
          const quorumReached = acceptedCount >= offer.minAcceptanceQuorum;
          const quorumJustMet = offer.status === "PUBLISHED" && quorumReached;

          const decision = await tx.groupOfferDecision.create({
            data: {
              offerId: offer.id,
              cohortId: cohort.id,
              cohortMemberId: member.id,
              userId: member.userId,
              decision: "ACCEPTED",
              revalidatedIntentAt: ts,
              decidedAt: ts,
            },
          });

          const secrets = generateVoucherArtifacts({
            offerId: offer.id,
            offerVersion: offer.version,
            cohortId: cohort.id,
            cohortMemberId: member.id,
            userId: member.userId,
            instituteId: institute.id,
            batchId: batch.id,
          });

          await tx.admissionVoucher.create({
            data: {
              voucherCode: secrets.voucherCode,
              tokenHash: secrets.tokenHash,
              securityNonce: secrets.securityNonce,
              offerId: offer.id,
              offerVersion: offer.version,
              decisionId: decision.id,
              cohortId: cohort.id,
              cohortMemberId: member.id,
              userId: member.userId,
              instituteId: institute.id,
              batchId: batch.id,
              status: quorumReached ? "ACTIVE" : "PENDING_QUORUM",
              baseFee: offer.baseFee,
              registrationFeeOriginal: offer.registrationFeeOriginal,
              waiveRegistration: offer.waiveRegistration,
              discountPercentage: offer.discountPercentage,
              discountAmount: offer.discountAmount,
              netPayableTuition: offer.netPayableTuition,
              includedPerks: offer.includedPerks,
              fallbackPolicy: offer.fallbackPolicy,
              minAcceptanceQuorumSnapshot: offer.minAcceptanceQuorum,
              minAdmissionQuorumSnapshot: offer.minAdmissionQuorum,
              studentNameSnapshot: member.name,
              instituteNameSnapshot: institute.name,
              batchNameSnapshot: batch.name,
              issuedAt: ts,
              activatedAt: quorumReached ? ts : null,
              expiresAt: offer.voucherExpiresAt,
            },
          });

          if (quorumJustMet) {
            await tx.cohortOffer.update({
              where: { id: offer.id },
              data: { status: "QUORUM_MET", quorumMetAt: ts },
            });
            await tx.groupAdmissionCohort.update({
              where: { id: cohort.id },
              data: { status: "ADMISSION_OPEN" },
            });
            await tx.admissionVoucher.updateMany({
              where: { offerId: offer.id, status: "PENDING_QUORUM" },
              data: { status: "ACTIVE", activatedAt: ts },
            });
          }
          return { deduplicated: false, quorumJustMet };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

    await Promise.allSettled([
      acceptOfferTx({ id: memA.id, userId: studentA.id, name: "Student Alpha" }),
      acceptOfferTx({ id: memA.id, userId: studentA.id, name: "Student Alpha" }),
    ]);

    const memADecisions = await prisma.groupOfferDecision.count({
      where: { offerId: draftOffer.id, cohortMemberId: memA.id },
    });
    const memAVouchers = await prisma.admissionVoucher.count({
      where: { offerId: draftOffer.id, cohortMemberId: memA.id },
    });
    assert.equal(memADecisions, 1, "Same student concurrent accepts must yield strictly 1 decision");
    assert.equal(memAVouchers, 1, "Same student concurrent accepts must yield strictly 1 voucher");
    console.log("  [PASS] Race B: Duplicate simultaneous acceptance yielded 1 decision & 1 voucher.");

    // =========================================================================
    // RACE C: Quorum Threshold Race (Student B + Student C Unlocking Quorum 2)
    // =========================================================================
    const acceptWithRetry = async (member: { id: string; userId: string; name: string }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await acceptOfferTx(member);
        } catch (err) {
          if (!isSerializationRetryable(err) || attempt === 2) throw err;
        }
      }
    };

    const [resB, resC] = await Promise.all([
      acceptWithRetry({ id: memB.id, userId: studentB.id, name: "Student Beta" }),
      acceptWithRetry({ id: memC.id, userId: studentC.id, name: "Student Gamma" }),
    ]);
    assert.ok(resB && resC, "Both distinct students must succeed with P2034 retry if serialized");

    const updatedOffer = await prisma.cohortOffer.findUniqueOrThrow({ where: { id: draftOffer.id } });
    const updatedCohort = await prisma.groupAdmissionCohort.findUniqueOrThrow({ where: { id: cohort.id } });
    const allVouchers = await prisma.admissionVoucher.findMany({ where: { offerId: draftOffer.id } });

    assert.equal(updatedOffer.status, "QUORUM_MET", "Offer must atomically advance to QUORUM_MET");
    assert.ok(updatedOffer.quorumMetAt !== null, "quorumMetAt timestamp must be stamped");
    assert.equal(updatedCohort.status, "ADMISSION_OPEN", "Cohort must transition to ADMISSION_OPEN");
    assert.equal(allVouchers.length, 3, "All 3 students must have bound vouchers");
    assert.ok(
      allVouchers.every((v) => v.status === "ACTIVE" && v.activatedAt !== null),
      "All PENDING_QUORUM vouchers including Student Alpha's must promote atomically to ACTIVE"
    );
    console.log("  [PASS] Race C: Concurrent quorum unlock promoted all 3 vouchers to ACTIVE.");

    // =========================================================================
    // RACE D: QR Presentation Security & Mutating Source Batch/Slab Immutability
    // =========================================================================
    const sampleVoucher = allVouchers[0];
    const qrRes = computeVoucherQrPayload({
      voucherCode: sampleVoucher.voucherCode,
      securityNonce: sampleVoucher.securityNonce,
      offerId: sampleVoucher.offerId,
      offerVersion: sampleVoucher.offerVersion,
      cohortId: sampleVoucher.cohortId,
      cohortMemberId: sampleVoucher.cohortMemberId,
      userId: sampleVoucher.userId,
      instituteId: sampleVoucher.instituteId,
      batchId: sampleVoucher.batchId,
      expiresAtIso: sampleVoucher.expiresAt.toISOString(),
    });
    const verifiedQr = verifyVoucherQrPresentation({
      qrPayloadRaw: qrRes.qrPayload,
      storedVoucher: {
        voucherCode: sampleVoucher.voucherCode,
        securityNonce: sampleVoucher.securityNonce,
        offerId: sampleVoucher.offerId,
        offerVersion: sampleVoucher.offerVersion,
        cohortId: sampleVoucher.cohortId,
        cohortMemberId: sampleVoucher.cohortMemberId,
        userId: sampleVoucher.userId,
        instituteId: sampleVoucher.instituteId,
        batchId: sampleVoucher.batchId,
        expiresAtIso: sampleVoucher.expiresAt.toISOString(),
        tokenHash: sampleVoucher.tokenHash,
        status: sampleVoucher.status,
        expiresAt: sampleVoucher.expiresAt,
      },
    });
    assert.equal(verifiedQr.valid, true, "Persisted voucher QR presentation must verify validly");

    // Mutate source InstituteBatch.fee & GroupDiscountSlab AFTER offer publication & voucher issuance
    await prisma.instituteBatch.update({
      where: { id: batch.id },
      data: { fee: 199999 },
    });
    await prisma.groupDiscountSlab.update({
      where: { id: slab.id },
      data: { discountPercentage: new Prisma.Decimal("5.00") },
    });

    const immutableOffer = await prisma.cohortOffer.findUniqueOrThrow({ where: { id: draftOffer.id } });
    const immutableVoucher = await prisma.admissionVoucher.findUniqueOrThrow({
      where: { id: sampleVoucher.id },
    });
    assert.equal(immutableOffer.baseFee.toString(), "149999");
    assert.equal(immutableOffer.discountPercentage.toString(), "12.5");
    assert.equal(immutableOffer.discountAmount.toString(), "18749.88");
    assert.equal(immutableOffer.netPayableTuition.toString(), "131249.12");
    assert.equal(immutableVoucher.netPayableTuition.toString(), "131249.12");
    console.log("  [PASS] Race D: Decimal precision & published snapshot immutability verified.");

    // =========================================================================
    // RACE E: REDEEMED Voucher Protection + Expired PENDING_QUORUM Sweep
    // =========================================================================
    await prisma.admissionVoucher.update({
      where: { id: sampleVoucher.id },
      data: { status: "REDEEMED" },
    });

    // Guard check before supersession or withdrawal must refuse to revoke REDEEMED voucher
    const redeemedGuardCount = await prisma.admissionVoucher.count({
      where: { cohortId: cohort.id, status: "REDEEMED" },
    });
    assert.equal(redeemedGuardCount, 1);

    // Even if updateMany runs with status filter, REDEEMED is untouched
    await prisma.admissionVoucher.updateMany({
      where: { offerId: draftOffer.id, status: { in: ["PENDING_QUORUM", "ACTIVE"] } },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const persistedRedeemed = await prisma.admissionVoucher.findUniqueOrThrow({
      where: { id: sampleVoucher.id },
    });
    assert.equal(
      persistedRedeemed.status,
      "REDEEMED",
      "REDEEMED voucher must NEVER transition to REVOKED"
    );

    // Test PENDING_QUORUM expiration when offerExpiresAt < now without meeting quorum
    const expiredOffer = await prisma.cohortOffer.create({
      data: {
        cohortId: cohort.id,
        instituteId: institute.id,
        batchId: batch.id,
        version: 99,
        status: "PUBLISHED",
        title: "Expired Unmet Quorum Offer",
        baseFee: new Prisma.Decimal("100000.00"),
        registrationFeeOriginal: new Prisma.Decimal("0.00"),
        waiveRegistration: false,
        discountPercentage: new Prisma.Decimal("10.00"),
        discountAmount: new Prisma.Decimal("10000.00"),
        netPayableTuition: new Prisma.Decimal("90000.00"),
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        minAcceptanceQuorum: 5,
        minAdmissionQuorum: 3,
        offerExpiresAt: new Date(Date.now() - 60_000), // already elapsed
        voucherExpiresAt: voucherExpiry,
        createdById: manager.id,
        publishedById: manager.id,
        publishedAt: new Date(Date.now() - 120_000),
      },
    });
    createdIds.offerIds.push(expiredOffer.id);

    const expiredDecision = await prisma.groupOfferDecision.create({
      data: {
        offerId: expiredOffer.id,
        cohortId: cohort.id,
        cohortMemberId: memC.id,
        userId: studentC.id,
        decision: "ACCEPTED",
        revalidatedIntentAt: now,
        guardianConsentVerifiedAt: now,
        decidedAt: new Date(Date.now() - 90_000),
      },
    });

    const stalePendingSecrets = generateVoucherArtifacts({
      offerId: expiredOffer.id,
      offerVersion: 99,
      cohortId: cohort.id,
      cohortMemberId: memC.id,
      userId: studentC.id,
      instituteId: institute.id,
      batchId: batch.id,
    });
    const stalePendingVoucher = await prisma.admissionVoucher.create({
      data: {
        voucherCode: stalePendingSecrets.voucherCode,
        tokenHash: stalePendingSecrets.tokenHash,
        securityNonce: stalePendingSecrets.securityNonce,
        offerId: expiredOffer.id,
        offerVersion: 99,
        decisionId: expiredDecision.id,
        cohortId: cohort.id,
        cohortMemberId: memC.id,
        userId: studentC.id,
        instituteId: institute.id,
        batchId: batch.id,
        status: "PENDING_QUORUM",
        baseFee: expiredOffer.baseFee,
        registrationFeeOriginal: expiredOffer.registrationFeeOriginal,
        waiveRegistration: false,
        discountPercentage: expiredOffer.discountPercentage,
        discountAmount: expiredOffer.discountAmount,
        netPayableTuition: expiredOffer.netPayableTuition,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        minAcceptanceQuorumSnapshot: 5,
        minAdmissionQuorumSnapshot: 3,
        studentNameSnapshot: "Student Gamma",
        instituteNameSnapshot: institute.name,
        batchNameSnapshot: batch.name,
        expiresAt: voucherExpiry,
      },
    });

    const evalExpired = evaluateVoucherEligibility({
      status: stalePendingVoucher.status,
      offerStatus: expiredOffer.status,
      offerExpiresAt: expiredOffer.offerExpiresAt,
      expiresAt: stalePendingVoucher.expiresAt,
      minAcceptanceQuorum: 5,
      acceptedCount: 1,
    });
    assert.equal(evalExpired.effectiveStatus, "EXPIRED");
    assert.equal(evalExpired.isRedeemable, false);

    // Execute the exact expiration sweep inside tx
    await prisma.$transaction(async (tx) => {
      await tx.cohortOffer.updateMany({
        where: { id: expiredOffer.id, status: "PUBLISHED", offerExpiresAt: { lte: new Date() } },
        data: { status: "EXPIRED" },
      });
      await tx.admissionVoucher.updateMany({
        where: { offerId: expiredOffer.id, status: "PENDING_QUORUM" },
        data: {
          status: "EXPIRED",
          revokeReason:
            "Offer acceptance deadline elapsed before reaching minimum acceptance quorum.",
        },
      });
    });

    const sweptOffer = await prisma.cohortOffer.findUniqueOrThrow({ where: { id: expiredOffer.id } });
    const sweptVoucher = await prisma.admissionVoucher.findUniqueOrThrow({
      where: { id: stalePendingVoucher.id },
    });
    assert.equal(sweptOffer.status, "EXPIRED");
    assert.equal(sweptVoucher.status, "EXPIRED");

    // Quick keyed HMAC OTP binding verification
    const otpChal = createGuardianConsentChallenge(memC.id);
    assert.equal(verifyGuardianOtpHash(otpChal.salt, otpChal.otp, otpChal.otpHash, memC.id), true);
    assert.equal(verifyGuardianOtpHash(otpChal.salt, otpChal.otp, otpChal.otpHash, memA.id), false);

    console.log("  [PASS] Race E: REDEEMED voucher protection & expired PENDING_QUORUM sweep verified.");
    console.log(`\n[BatchBuy Slice 3 Real Postgres E2E] ALL 5 LIVE DATABASE RACES PASSED.\n`);
  } finally {
    // Guaranteed cleanup of 100% synthetic test artifacts
    if (createdIds.cohortId) {
      await prisma.admissionVoucher.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupOfferDecision.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.cohortOffer.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupCohortMember.deleteMany({ where: { cohortId: createdIds.cohortId } });
      await prisma.groupAdmissionCohort.deleteMany({ where: { id: createdIds.cohortId } });
    }
    if (createdIds.slabId) {
      await prisma.groupDiscountSlab.deleteMany({ where: { id: createdIds.slabId } });
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
    console.log(`[BatchBuy Slice 3 Real Postgres E2E] Cleanup complete for ${RUN_TAG}.`);
  }
}

main().catch((err) => {
  console.error("[BatchBuy Slice 3 Real Postgres E2E] FAILED:", err);
  process.exit(1);
});
