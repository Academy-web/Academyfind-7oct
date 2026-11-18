import {
  computeOfferFeeBreakdown,
  validateOfferQuorumsAndDates,
  evaluateVoucherEligibility,
} from "../../lib/batchbuy/offerValidation";
import {
  generateVoucherArtifacts,
  computeVoucherQrPayload,
  verifyVoucherQrSignature,
  verifyVoucherQrPresentation,
  createGuardianConsentChallenge,
  verifyGuardianOtpHash,
  validateBatchBuyCryptoConfig,
} from "../../lib/batchbuy/voucherCrypto";

describe("BatchBuy Slice 3: Offer Validation, Fee Math & Voucher Crypto", () => {
  test("computes paise-accurate fee breakdown without floating point drift", () => {
    const breakdown = computeOfferFeeBreakdown({
      baseFee: 149999,
      registrationFeeOriginal: 2500,
      waiveRegistration: true,
      discountPercentage: 12.5,
    });

    // 149999 * 0.125 = 18749.875 -> 18749.88 rounded paise
    expect(breakdown.discountAmount).toBe(18749.88);
    expect(breakdown.netPayableTuition).toBe(131249.12);
    expect(breakdown.discountAmountStr).toBe("18749.88");
    expect(breakdown.netPayableTuitionStr).toBe("131249.12");
    expect(breakdown.totalSavings).toBe(21249.88);
  });

  test("rejects admission quorum exceeding acceptance quorum or cohort capacity", () => {
    const futureOffer = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const futureVoucher = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    expect(() =>
      validateOfferQuorumsAndDates({
        minAcceptanceQuorum: 30,
        minAdmissionQuorum: 10,
        cohortMaxCapacity: 25,
        offerExpiresAtRaw: futureOffer,
        voucherExpiresAtRaw: futureVoucher,
      })
    ).toThrow(/exceed the cohort maximum capacity/i);

    expect(() =>
      validateOfferQuorumsAndDates({
        minAcceptanceQuorum: 5,
        minAdmissionQuorum: 6,
        cohortMaxCapacity: 25,
        offerExpiresAtRaw: futureOffer,
        voucherExpiresAtRaw: futureVoucher,
      })
    ).toThrow(/exceed the acceptance quorum/i);

    expect(() =>
      validateOfferQuorumsAndDates({
        minAcceptanceQuorum: 6,
        minAdmissionQuorum: 4,
        cohortMaxCapacity: 25,
        offerExpiresAtRaw: futureVoucher,
        voucherExpiresAtRaw: futureOffer, // earlier than offer expiry
      })
    ).toThrow(/on or after/i);
  });

  test("generates cryptographically distinct voucher secrets & verifies HMAC QR signature", () => {
    const binding = {
      offerId: "offer_1",
      offerVersion: 2,
      cohortId: "cohort_1",
      cohortMemberId: "mem_1",
      userId: "user_1",
      instituteId: "inst_1",
      batchId: "batch_1",
    };

    const a = generateVoucherArtifacts(binding);
    const b = generateVoucherArtifacts(binding);

    expect(a.voucherCode).toMatch(/^AFBB-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    expect(a.voucherCode).not.toBe(b.voucherCode);
    expect(a.securityNonce).not.toBe(b.securityNonce);
    expect(a.tokenHash).not.toBe(b.tokenHash);
    expect(a.tokenHash).toHaveLength(64);

    const expiresAtIso = "2027-01-15T12:00:00.000Z";
    const { qrPayload } = computeVoucherQrPayload({
      ...binding,
      voucherCode: a.voucherCode,
      securityNonce: a.securityNonce,
      expiresAtIso,
    });
    const parsed = JSON.parse(qrPayload) as { v: number; code: string; sig: string };

    expect(parsed.code).toBe(a.voucherCode);
    expect(
      verifyVoucherQrSignature(
        {
          ...binding,
          voucherCode: a.voucherCode,
          securityNonce: a.securityNonce,
          expiresAtIso,
        },
        parsed.sig
      )
    ).toBe(true);

    // Reject if userId binding or signature is tampered with
    expect(
      verifyVoucherQrSignature(
        {
          ...binding,
          userId: "attacker_user",
          voucherCode: a.voucherCode,
          securityNonce: a.securityNonce,
          expiresAtIso,
        },
        parsed.sig
      )
    ).toBe(false);
  });

  test("creates and verifies salted keyed-HMAC Guardian Consent OTP challenge bound to member contextId", () => {
    const challenge = createGuardianConsentChallenge("mem_minor_1");
    expect(challenge.otp).toMatch(/^\d{6}$/);
    expect(verifyGuardianOtpHash(challenge.salt, challenge.otp, challenge.otpHash, "mem_minor_1")).toBe(true);
    expect(verifyGuardianOtpHash(challenge.salt, challenge.otp, challenge.otpHash, "mem_other")).toBe(false);
    expect(verifyGuardianOtpHash(challenge.salt, "000000", challenge.otpHash, "mem_minor_1")).toBe(
      challenge.otp === "000000"
    );
    expect(verifyGuardianOtpHash("wrong-salt", challenge.otp, challenge.otpHash, "mem_minor_1")).toBe(false);
  });

  test("supports QR HMAC secret rotation via kid and validates read-only QR presentation strictly", () => {
    const origKid = process.env.VOUCHER_HMAC_KEY_ID;
    const origSecret = process.env.VOUCHER_HMAC_SECRET;
    const origPrev = process.env.VOUCHER_HMAC_PREVIOUS_SECRETS;

    try {
      const binding = {
        offerId: "offer_rot_1",
        offerVersion: 1,
        cohortId: "coh_rot_1",
        cohortMemberId: "mem_rot_1",
        userId: "user_rot_1",
        instituteId: "inst_rot_1",
        batchId: "batch_rot_1",
      };
      const artifacts = generateVoucherArtifacts(binding);
      const futureDate = new Date(Date.now() + 86_400_000);
      const expiresAtIso = futureDate.toISOString();

      process.env.VOUCHER_HMAC_KEY_ID = "k1";
      process.env.VOUCHER_HMAC_SECRET = "test-secret-v1-key-material";
      delete process.env.VOUCHER_HMAC_PREVIOUS_SECRETS;

      const oldPayload = computeVoucherQrPayload({
        ...binding,
        voucherCode: artifacts.voucherCode,
        securityNonce: artifacts.securityNonce,
        expiresAtIso,
      });
      const parsedOld = JSON.parse(oldPayload.qrPayload) as Record<string, unknown>;
      expect(parsedOld.kid).toBe("k1");
      // Strictly zero PII in QR JSON
      expect(parsedOld).not.toHaveProperty("userId");
      expect(parsedOld).not.toHaveProperty("studentName");
      expect(parsedOld).not.toHaveProperty("phone");

      // Rotate key to k2 while retaining k1 in previous secrets CSV
      process.env.VOUCHER_HMAC_KEY_ID = "k2";
      process.env.VOUCHER_HMAC_SECRET = "test-secret-v2-key-material";
      process.env.VOUCHER_HMAC_PREVIOUS_SECRETS = "k1:test-secret-v1-key-material";

      const storedVoucher = {
        ...binding,
        voucherCode: artifacts.voucherCode,
        securityNonce: artifacts.securityNonce,
        expiresAtIso,
        tokenHash: artifacts.tokenHash,
        status: "ACTIVE",
        expiresAt: futureDate,
      };

      expect(
        verifyVoucherQrPresentation({
          qrPayloadRaw: oldPayload.qrPayload,
          storedVoucher,
        }).valid
      ).toBe(true);

      // Reject tampered signature, wrong status, expired voucher, and wrong tokenHash
      expect(
        verifyVoucherQrPresentation({
          qrPayloadRaw: oldPayload.qrPayload,
          storedVoucher: { ...storedVoucher, status: "PENDING_QUORUM" },
        }).valid
      ).toBe(false);

      expect(
        verifyVoucherQrPresentation({
          qrPayloadRaw: oldPayload.qrPayload,
          storedVoucher: { ...storedVoucher, expiresAt: new Date(Date.now() - 1000) },
        }).valid
      ).toBe(false);

      expect(
        verifyVoucherQrPresentation({
          qrPayloadRaw: oldPayload.qrPayload,
          storedVoucher: { ...storedVoucher, tokenHash: "a".repeat(64) },
        }).valid
      ).toBe(false);
    } finally {
      process.env.VOUCHER_HMAC_KEY_ID = origKid;
      process.env.VOUCHER_HMAC_SECRET = origSecret;
      process.env.VOUCHER_HMAC_PREVIOUS_SECRETS = origPrev;
    }
  });

  test("evaluates redemption eligibility strictly by quorum, status and expiry", () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    const pending = evaluateVoucherEligibility({
      status: "PENDING_QUORUM",
      offerStatus: "PUBLISHED",
      offerExpiresAt: future,
      expiresAt: future,
      minAcceptanceQuorum: 5,
      acceptedCount: 2,
    });
    expect(pending.isRedeemable).toBe(false);
    expect(pending.effectiveStatus).toBe("PENDING_QUORUM");

    // Elapsed offerExpiresAt invalidates PENDING_QUORUM even before voucherExpiresAt
    const pendingExpiredOffer = evaluateVoucherEligibility({
      status: "PENDING_QUORUM",
      offerStatus: "PUBLISHED",
      offerExpiresAt: past,
      expiresAt: future,
      minAcceptanceQuorum: 5,
      acceptedCount: 2,
    });
    expect(pendingExpiredOffer.isRedeemable).toBe(false);
    expect(pendingExpiredOffer.effectiveStatus).toBe("EXPIRED");

    const active = evaluateVoucherEligibility({
      status: "ACTIVE",
      offerStatus: "QUORUM_MET",
      expiresAt: future,
      minAcceptanceQuorum: 5,
      acceptedCount: 5,
    });
    expect(active.isRedeemable).toBe(true);
    expect(active.effectiveStatus).toBe("ACTIVE");

    const expired = evaluateVoucherEligibility({
      status: "ACTIVE",
      offerStatus: "QUORUM_MET",
      expiresAt: past,
      minAcceptanceQuorum: 5,
      acceptedCount: 5,
    });
    expect(expired.isRedeemable).toBe(false);
    expect(expired.effectiveStatus).toBe("EXPIRED");

    const revoked = evaluateVoucherEligibility({
      status: "ACTIVE",
      offerStatus: "SUPERSEDED",
      expiresAt: future,
      minAcceptanceQuorum: 5,
      acceptedCount: 5,
    });
    expect(revoked.isRedeemable).toBe(false);
    expect(revoked.effectiveStatus).toBe("REVOKED");
  });

  test("fails fast in production if VOUCHER_HMAC_SECRET or GUARDIAN_OTP_HMAC_SECRET is missing or short", () => {
    const origEnv = { ...process.env };
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.VOUCHER_HMAC_SECRET;
      delete process.env.GUARDIAN_OTP_HMAC_SECRET;
      process.env.BETTER_AUTH_SECRET = "better-auth-fallback-secret-must-not-be-used-32plus";

      expect(() =>
        computeVoucherQrPayload({
          voucherCode: "AFBB-AAAA-BBBB-CCCC",
          securityNonce: "nonce-1234",
          offerId: "offer_1",
          offerVersion: 1,
          cohortId: "coh_1",
          cohortMemberId: "mem_1",
          userId: "user_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          expiresAtIso: "2027-01-15T12:00:00.000Z",
        })
      ).toThrow(/VOUCHER_HMAC_SECRET/i);

      expect(() =>
        createGuardianConsentChallenge("123456")
      ).toThrow(/GUARDIAN_OTP_HMAC_SECRET/i);

      process.env.VOUCHER_HMAC_SECRET = "too-short";
      expect(() =>
        computeVoucherQrPayload({
          voucherCode: "AFBB-AAAA-BBBB-CCCC",
          securityNonce: "nonce-1234",
          offerId: "offer_1",
          offerVersion: 1,
          cohortId: "coh_1",
          cohortMemberId: "mem_1",
          userId: "user_1",
          instituteId: "inst_1",
          batchId: "batch_1",
          expiresAtIso: "2027-01-15T12:00:00.000Z",
        })
      ).toThrow(/32 characters/i);
    } finally {
      process.env = origEnv;
    }
  });

  test("supports Guardian OTP secret rotation via GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS and rejects malformed rotated secrets", () => {
    const origEnv = { ...process.env };
    try {
      const oldOtpSecret = "old-guardian-otp-secret-32-chars-minimum-value";
      const newOtpSecret = "new-guardian-otp-secret-32-chars-minimum-value";
      process.env.GUARDIAN_OTP_HMAC_SECRET = oldOtpSecret;
      delete process.env.GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS;

      const challenge = createGuardianConsentChallenge("mem_rotate_ctx");

      // Rotate primary secret and keep old secret in GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS
      process.env.GUARDIAN_OTP_HMAC_SECRET = newOtpSecret;
      process.env.GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS = `k0:${oldOtpSecret}`;

      expect(
        verifyGuardianOtpHash(
          challenge.salt,
          challenge.otp,
          challenge.otpHash,
          "mem_rotate_ctx"
        )
      ).toBe(true);
      expect(
        verifyGuardianOtpHash(
          challenge.salt,
          "000000",
          challenge.otpHash,
          "mem_rotate_ctx"
        )
      ).toBe(false);

      // Fail-fast on malformed VOUCHER_HMAC_PREVIOUS_SECRETS (missing kid:secret separator)
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.VOUCHER_HMAC_SECRET = "prod-voucher-hmac-secret-32-chars-minimum";
      process.env.VOUCHER_HMAC_PREVIOUS_SECRETS = "missing_kid_separator_secret";
      expect(() => validateBatchBuyCryptoConfig()).toThrow(/kid:secret/i);

      // Valid rotated production crypto config succeeds
      process.env.VOUCHER_HMAC_PREVIOUS_SECRETS = `k0:${oldOtpSecret}`;
      expect(() => validateBatchBuyCryptoConfig()).not.toThrow();
    } finally {
      process.env = origEnv;
    }
  });
});
