import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { TRIAL_COOKIE_NAME, verifyTrialCookie } from "@/lib/subscription/trialCookie";
import { getInstituteEntitlements } from "@/lib/subscription/entitlements";
import TrialActivateClient from "./TrialActivateClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "7-Day Elite Free Trial | AcademyFind",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TrialActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const ctx = verifyTrialCookie(cookieStore.get(TRIAL_COOKIE_NAME)?.value);

  if (!ctx || sp?.status === "invalid") {
    return (
      <TrialActivateClient
        initialState="INVALID"
        instituteId={null}
        instituteName={null}
        expiresAt={null}
        daysRemaining={null}
      />
    );
  }

  const [trial, entitlements] = await Promise.all([
    prisma.instituteTrial.findUnique({
      where: { tokenHash: ctx.tokenHash },
      include: {
        institute: { select: { id: true, name: true, slug: true, hasUsedTrial: true } },
      },
    }),
    getInstituteEntitlements(ctx.instituteId),
  ]);

  if (!trial || !entitlements) {
    return (
      <TrialActivateClient
        initialState="INVALID"
        instituteId={null}
        instituteName={null}
        expiresAt={null}
        daysRemaining={null}
      />
    );
  }

  let initialState: "READY" | "ACTIVE" | "ALREADY_PAID" | "EXPIRED" | "INVALID" = "READY";
  if (entitlements.isTrialActive) {
    initialState = "ACTIVE";
  } else if (entitlements.isPaidPlan) {
    initialState = "ALREADY_PAID";
  } else if (trial.status === "EXPIRED" || trial.institute.hasUsedTrial) {
    initialState = "EXPIRED";
  } else if (trial.tokenExpiresAt && trial.tokenExpiresAt <= new Date()) {
    initialState = "EXPIRED";
  }

  return (
    <TrialActivateClient
      initialState={initialState}
      instituteId={trial.institute.id}
      instituteName={trial.institute.name}
      expiresAt={entitlements.expiresAt ? entitlements.expiresAt.toISOString() : null}
      daysRemaining={entitlements.daysRemaining}
    />
  );
}
