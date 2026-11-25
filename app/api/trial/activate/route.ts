import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import {
  activateTrialFromDashboard,
  activateTrialFromToken,
} from "@/lib/subscription/trial";
import { TRIAL_COOKIE_NAME, verifyTrialCookie } from "@/lib/subscription/trialCookie";
import { processOutboxEvents } from "@/lib/subscription/outbox";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === "dashboard" ? "dashboard" : "token";

    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (mode === "dashboard") {
      if (!session?.user?.id) {
        return NextResponse.json(
          { success: false, error: "Authentication required." },
          { status: 401 }
        );
      }
      const instituteId = typeof body?.instituteId === "string" ? body.instituteId : "";
      if (!instituteId) {
        return NextResponse.json(
          { success: false, error: "instituteId is required." },
          { status: 400 }
        );
      }

      const result = await activateTrialFromDashboard({
        instituteId,
        userId: session.user.id,
        userRole: session.user.role,
      });

      if (!result.success) {
        const status = result.code === "FORBIDDEN" ? 403 : 400;
        return NextResponse.json(result, { status });
      }

      try {
        await processOutboxEvents(3);
      } catch (e) {
        console.error("Outbox best-effort flush error:", e);
      }

      return NextResponse.json(result);
    }

    // Token activation path (from HttpOnly cookie exchanged by /api/trial/open)
    const cookieStore = await cookies();
    const rawCookie = cookieStore.get(TRIAL_COOKIE_NAME)?.value;
    const ctx = verifyTrialCookie(rawCookie);

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          code: "MISSING_CONTEXT",
          error: "Your trial activation session expired. Please click the link in your email again.",
        },
        { status: 401 }
      );
    }

    const result = await activateTrialFromToken({
      tokenHash: ctx.tokenHash,
      actorUserId: session?.user?.id ?? null,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    try {
      await processOutboxEvents(3);
    } catch (e) {
      console.error("Outbox best-effort flush error:", e);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/trial/activate error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to activate free trial." },
      { status: 500 }
    );
  }
}
