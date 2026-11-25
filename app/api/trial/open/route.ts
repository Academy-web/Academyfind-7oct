import { NextResponse } from "next/server";
import { hashTrialToken, recordTokenLinkAccess } from "@/lib/subscription/trial";
import { signTrialCookie, TRIAL_COOKIE_NAME } from "@/lib/subscription/trialCookie";

export const revalidate = 0;

/**
 * Scanner-safe GET endpoint:
 * - Never activates a trial or sets hasUsedTrial.
 * - Logs linkAccessedAt & accessCount.
 * - Exchanges raw URL token for a short-lived HttpOnly cookie and 302 redirects
 *   to clean /trial/activate without the token in browser history or referrer headers.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim();
  const cleanRedirectUrl = new URL("/trial/activate", url.origin);

  const responseHeaders = {
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (!rawToken || rawToken.length < 16) {
    cleanRedirectUrl.searchParams.set("status", "invalid");
    return NextResponse.redirect(cleanRedirectUrl, { status: 302, headers: responseHeaders });
  }

  const tokenHash = hashTrialToken(rawToken);
  const trial = await recordTokenLinkAccess(tokenHash);

  if (!trial) {
    cleanRedirectUrl.searchParams.set("status", "invalid");
    return NextResponse.redirect(cleanRedirectUrl, { status: 302, headers: responseHeaders });
  }

  const signedCookie = signTrialCookie({
    tokenHash,
    instituteId: trial.instituteId,
  });

  const response = NextResponse.redirect(cleanRedirectUrl, {
    status: 302,
    headers: responseHeaders,
  });

  response.cookies.set(TRIAL_COOKIE_NAME, signedCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 60,
  });

  return response;
}
