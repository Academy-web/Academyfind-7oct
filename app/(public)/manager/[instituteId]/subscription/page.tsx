import { prisma } from "@/lib/prisma";
import { getInstituteEntitlements } from "@/lib/subscription/entitlements";
import SubscriptionClient from "./Subscription";

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ instituteId: string }>;
}) {
  const { instituteId } = await params;

  const [institute, entitlements] = await Promise.all([
    prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true } }),
    getInstituteEntitlements(instituteId),
  ]);

  if (!institute || !entitlements) return null;

  const latestPayment = await prisma.subscriptionPayment.findFirst({
    where: {
      instituteId: institute.id,
      status: "APPROVED",
      planRequested: entitlements.effectivePlan,
    },
    orderBy: { createdAt: "desc" },
  });
  const currentBillingCycle =
    latestPayment?.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  return (
    <SubscriptionClient
      currentPlan={entitlements.effectivePlan}
      currentBillingCycle={currentBillingCycle}
      instituteId={institute.id}
      isTrialActive={entitlements.isTrialActive}
      canActivateTrial={entitlements.canActivateTrial}
      daysRemaining={entitlements.daysRemaining}
      trialExpiresAt={entitlements.expiresAt ? entitlements.expiresAt.toISOString() : null}
    />
  );
}
