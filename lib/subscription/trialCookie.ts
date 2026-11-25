import crypto from "crypto";

export const TRIAL_COOKIE_NAME = "af_trial_ctx";
const COOKIE_TTL_SECONDS = 30 * 60; // 30 minutes

function getCookieSecret(): string {
  return (
    process.env.TRIAL_COOKIE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.CRON_SECRET ||
    "academyfind-dev-trial-cookie-secret"
  );
}

export interface TrialCookiePayload {
  tokenHash: string;
  instituteId: string;
  exp: number;
}

export function signTrialCookie(payload: Omit<TrialCookiePayload, "exp">): string {
  const fullPayload: TrialCookiePayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getCookieSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyTrialCookie(cookieValue: string | undefined | null): TrialCookiePayload | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", getCookieSecret())
    .update(encoded)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TrialCookiePayload;
    if (!parsed.tokenHash || !parsed.instituteId || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
