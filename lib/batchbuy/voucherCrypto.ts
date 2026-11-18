import crypto from "node:crypto";

const VOUCHER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars (exact 5-bit mask, zero modulo bias)

function parsePreviousSecretsList(
  raw: string,
  envVarName: string,
  requireKidPrefix: boolean
): { entries: Array<{ kid: string | null; secret: string }> } {
  const isProd = process.env.NODE_ENV === "production";
  const entries: Array<{ kid: string | null; secret: string }> = [];

  for (const rawItem of raw.split(",")) {
    const trimmed = rawItem.trim();
    if (!trimmed) continue;

    const sepIdx = trimmed.indexOf(":");
    if (requireKidPrefix) {
      if (sepIdx <= 0 || sepIdx >= trimmed.length - 1) {
        throw new Error(
          `Invalid ${envVarName} entry: expected "kid:secret" format for rotated keys.`
        );
      }
      const kid = trimmed.slice(0, sepIdx).trim();
      const secret = trimmed.slice(sepIdx + 1).trim();
      if (!kid || !secret) {
        throw new Error(`Invalid ${envVarName} entry: key id and secret must be non-empty.`);
      }
      if (isProd && secret.length < 32) {
        throw new Error(
          `Invalid ${envVarName} secret for kid "${kid}": rotated secrets must be >= 32 characters in production.`
        );
      }
      entries.push({ kid, secret });
      continue;
    }

    const hasKidPrefix = sepIdx > 0 && sepIdx < trimmed.length - 1;
    const kid = hasKidPrefix ? trimmed.slice(0, sepIdx).trim() : null;
    const secret = hasKidPrefix ? trimmed.slice(sepIdx + 1).trim() : trimmed;
    if (!secret) {
      throw new Error(`Invalid ${envVarName} entry: secret cannot be empty.`);
    }
    if (isProd && secret.length < 32) {
      throw new Error(
        `Invalid ${envVarName} entry: rotated secrets must be >= 32 characters in production.`
      );
    }
    entries.push({ kid, secret });
  }

  return { entries };
}

function getVoucherHmacKeyConfig(): {
  currentKid: string;
  currentSecret: string;
  keyRing: Map<string, string>;
} {
  const isProd = process.env.NODE_ENV === "production";
  const currentKid = (process.env.VOUCHER_HMAC_KEY_ID || "k1").trim() || "k1";
  const dedicatedSecret = process.env.VOUCHER_HMAC_SECRET?.trim() || "";

  if (isProd) {
    if (!dedicatedSecret || dedicatedSecret.length < 32) {
      throw new Error(
        "VOUCHER_HMAC_SECRET must be set (>= 32 characters) in production. Fallback to BETTER_AUTH_SECRET is disabled."
      );
    }
  }

  const currentSecret =
    dedicatedSecret ||
    process.env.BETTER_AUTH_SECRET ||
    "academyfind-batchbuy-dev-voucher-secret";

  const keyRing = new Map<string, string>();
  keyRing.set(currentKid, currentSecret);

  // Optional zero-downtime key rotation format: "k0:old_secret,k_prev:older_secret"
  const prevRaw = process.env.VOUCHER_HMAC_PREVIOUS_SECRETS || "";
  const { entries } = parsePreviousSecretsList(prevRaw, "VOUCHER_HMAC_PREVIOUS_SECRETS", true);
  for (const { kid, secret } of entries) {
    if (kid && !keyRing.has(kid)) {
      keyRing.set(kid, secret);
    }
  }

  return { currentKid, currentSecret, keyRing };
}

function getGuardianOtpHmacSecrets(): string[] {
  const isProd = process.env.NODE_ENV === "production";
  const dedicatedSecret = process.env.GUARDIAN_OTP_HMAC_SECRET?.trim() || "";

  if (isProd) {
    if (!dedicatedSecret || dedicatedSecret.length < 32) {
      throw new Error(
        "GUARDIAN_OTP_HMAC_SECRET must be set (>= 32 characters) in production. Fallback to BETTER_AUTH_SECRET is disabled."
      );
    }
  }

  const primary =
    dedicatedSecret ||
    process.env.BETTER_AUTH_SECRET ||
    "academyfind-batchbuy-dev-guardian-otp-secret";

  const secrets = [primary];
  const prevRaw = process.env.GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS || "";
  const { entries } = parsePreviousSecretsList(
    prevRaw,
    "GUARDIAN_OTP_HMAC_PREVIOUS_SECRETS",
    false
  );
  for (const { secret } of entries) {
    if (!secrets.includes(secret)) {
      secrets.push(secret);
    }
  }

  return secrets;
}

/**
 * Validates BatchBuy cryptographic secrets & rotation configs upfront (fail-fast at startup/tests).
 */
export function validateBatchBuyCryptoConfig(): {
  voucherCurrentKid: string;
  voucherKeyRingSize: number;
  guardianKeyRingSize: number;
} {
  const v = getVoucherHmacKeyConfig();
  const g = getGuardianOtpHmacSecrets();
  return {
    voucherCurrentKid: v.currentKid,
    voucherKeyRingSize: v.keyRing.size,
    guardianKeyRingSize: g.length,
  };
}

/**
 * Generates a tamper-resistant voucher code formatted as `AFBB-XXXX-XXXX-XXXX`
 * using unbiased cryptographic random bits (`32^12` keyspace).
 */
export function generateCryptographicVoucherCode(): string {
  const bytes = crypto.randomBytes(12);
  let raw = "";
  for (let i = 0; i < 12; i++) {
    raw += VOUCHER_ALPHABET[bytes[i] & 31];
  }
  return `AFBB-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export interface VoucherBindingInput {
  offerId: string;
  offerVersion: number;
  cohortId: string;
  cohortMemberId: string;
  userId: string;
  instituteId: string;
  batchId: string;
}

export interface GeneratedVoucherSecrets {
  voucherCode: string;
  securityNonce: string;
  tokenHash: string;
}

/**
 * Creates cryptographically unique, non-predictable voucher identifiers bound to
 * one student, one cohort, one offer version, one institute and one batch.
 */
export function generateVoucherArtifacts(
  binding: VoucherBindingInput
): GeneratedVoucherSecrets {
  const voucherCode = generateCryptographicVoucherCode();
  const securityNonce = crypto.randomBytes(24).toString("hex");
  const canonicalBinding = [
    voucherCode,
    securityNonce,
    binding.offerId,
    String(binding.offerVersion),
    binding.cohortId,
    binding.cohortMemberId,
    binding.userId,
    binding.instituteId,
    binding.batchId,
  ].join(":");

  const tokenHash = crypto
    .createHash("sha256")
    .update(canonicalBinding)
    .digest("hex");

  return {
    voucherCode,
    securityNonce,
    tokenHash,
  };
}

export interface VoucherQrSignatureInput extends VoucherBindingInput {
  voucherCode: string;
  securityNonce: string;
  expiresAtIso: string;
}

function computeCanonicalVoucherString(input: VoucherQrSignatureInput): string {
  return [
    "v1",
    input.voucherCode,
    input.offerId,
    String(input.offerVersion),
    input.cohortId,
    input.cohortMemberId,
    input.userId,
    input.instituteId,
    input.batchId,
    input.securityNonce,
    input.expiresAtIso,
  ].join("|");
}

/**
 * Computes a versioned, zero-PII HMAC-SHA256 signature for the student's voucher QR code
 * and short verification checksum, preventing forgery or code guessing while supporting key rotation.
 */
export function computeVoucherQrPayload(input: VoucherQrSignatureInput): {
  qrPayload: string;
  verificationChecksum: string;
  fullHmac: string;
  keyId: string;
} {
  const { currentKid, currentSecret } = getVoucherHmacKeyConfig();
  const canonical = computeCanonicalVoucherString(input);

  const fullHmac = crypto
    .createHmac("sha256", currentSecret)
    .update(`${currentKid}|${canonical}`)
    .digest("hex");

  // Strict zero-PII QR payload (only voucher identifier, offer ref, key id and truncated HMAC)
  const payload = JSON.stringify({
    v: 1,
    kid: currentKid,
    code: input.voucherCode,
    off: input.offerId,
    ver: input.offerVersion,
    sig: fullHmac.slice(0, 32),
  });

  return {
    qrPayload: payload,
    verificationChecksum: fullHmac.slice(0, 8).toUpperCase(),
    fullHmac,
    keyId: currentKid,
  };
}

/**
 * Constant-time verification of a scanned voucher QR signature against stored voucher bindings,
 * supporting both current and rotated HMAC keys configured in VOUCHER_HMAC_PREVIOUS_SECRETS.
 */
export function verifyVoucherQrSignature(
  input: VoucherQrSignatureInput,
  candidateSig: string,
  candidateKid?: string | null
): boolean {
  if (!candidateSig || candidateSig.length !== 32) return false;
  const { currentKid, keyRing } = getVoucherHmacKeyConfig();
  const canonical = computeCanonicalVoucherString(input);

  const kidsToTry = candidateKid
    ? keyRing.has(candidateKid)
      ? [candidateKid]
      : []
    : Array.from(keyRing.keys());

  for (const kid of kidsToTry) {
    const secret = keyRing.get(kid);
    if (!secret) continue;

    // Support both current kid-prefixed canonical input and legacy unprefixed canonical format
    const inputs =
      kid === currentKid
        ? [`${kid}|${canonical}`, canonical]
        : [`${kid}|${canonical}`, canonical];

    for (const signedPayload of inputs) {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex")
        .slice(0, 32);

      try {
        if (
          crypto.timingSafeEqual(
            Buffer.from(expected, "utf8"),
            Buffer.from(candidateSig, "utf8")
          )
        ) {
          return true;
        }
      } catch {
        // Length/encoding mismatch; continue safely
      }
    }
  }

  return false;
}

/**
 * Read-only server-side verifier for scanned QR payload JSON against stored voucher DB fields.
 * Verifies payload format, voucherCode/offerId/version match, tokenHash integrity,
 * HMAC signature (including rotated keys), expiry, and status without performing redemption.
 */
export function verifyVoucherQrPresentation(params: {
  qrPayloadRaw: string;
  storedVoucher: VoucherQrSignatureInput & {
    tokenHash: string;
    status: string;
    expiresAt: Date;
  };
  now?: Date;
}): {
  valid: boolean;
  reason: string;
} {
  const now = params.now ?? new Date();
  let parsed: { v?: number; kid?: string; code?: string; off?: string; ver?: number; sig?: string };
  try {
    parsed = JSON.parse(params.qrPayloadRaw) as typeof parsed;
  } catch {
    return { valid: false, reason: "Malformed voucher QR payload." };
  }

  if (
    parsed.v !== 1 ||
    !parsed.code ||
    !parsed.off ||
    typeof parsed.ver !== "number" ||
    !parsed.sig
  ) {
    return { valid: false, reason: "Incomplete voucher QR fields." };
  }

  const v = params.storedVoucher;
  if (parsed.code !== v.voucherCode || parsed.off !== v.offerId || parsed.ver !== v.offerVersion) {
    return { valid: false, reason: "Voucher QR does not match bound cohort offer or code." };
  }

  // Verify tokenHash binding integrity
  const expectedTokenHash = crypto
    .createHash("sha256")
    .update(
      [
        v.voucherCode,
        v.securityNonce,
        v.offerId,
        String(v.offerVersion),
        v.cohortId,
        v.cohortMemberId,
        v.userId,
        v.instituteId,
        v.batchId,
      ].join(":")
    )
    .digest("hex");

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedTokenHash, "hex"),
        Buffer.from(v.tokenHash, "hex")
      )
    ) {
      return { valid: false, reason: "Voucher binding token integrity check failed." };
    }
  } catch {
    return { valid: false, reason: "Voucher binding token integrity check failed." };
  }

  if (!verifyVoucherQrSignature(v, parsed.sig, parsed.kid)) {
    return { valid: false, reason: "Cryptographic QR signature verification failed." };
  }

  if (v.status !== "ACTIVE") {
    return { valid: false, reason: `Voucher is ${v.status} and cannot be redeemed.` };
  }

  if (v.expiresAt <= now) {
    return { valid: false, reason: "Voucher has passed its redemption validity expiry." };
  }

  return { valid: true, reason: "Valid, authentic BatchBuy voucher." };
}

/**
 * Generates a 6-digit OTP and keyed HMAC-SHA256 digest bound to a random salt
 * and optional member challenge context so short OTPs resist offline guessing.
 */
export function createGuardianConsentChallenge(contextId?: string): {
  otp: string;
  salt: string;
  otpHash: string;
} {
  const otp = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString("hex");
  const otpHash = hashGuardianOtp(salt, otp, contextId);
  return { otp, salt, otpHash };
}

export function hashGuardianOtp(
  salt: string,
  otp: string,
  contextId?: string,
  secretOverride?: string
): string {
  const contextPart = contextId ? `:${contextId}` : "";
  const secret = secretOverride ?? getGuardianOtpHmacSecrets()[0];
  return crypto
    .createHmac("sha256", secret)
    .update(`guardian-consent:${salt}${contextPart}:${otp.trim()}`)
    .digest("hex");
}

export function verifyGuardianOtpHash(
  salt: string,
  candidateOtp: string,
  expectedHash: string,
  contextId?: string
): boolean {
  if (!salt || !expectedHash || !/^\d{6}$/.test(candidateOtp.trim())) {
    return false;
  }
  for (const secret of getGuardianOtpHmacSecrets()) {
    const actualHash = hashGuardianOtp(salt, candidateOtp.trim(), contextId, secret);
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(actualHash, "hex"),
          Buffer.from(expectedHash, "hex")
        )
      ) {
        return true;
      }
    } catch {
      // Length/encoding mismatch; continue safely
    }
  }
  return false;
}
