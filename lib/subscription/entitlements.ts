import { prisma } from "@/lib/prisma";
import { PLAN_DISPLAY_NAMES, PLAN_LIMITS, PlanType } from "@/lib/plan_limits";
import type { PrismaClient, SubscriptionPlan, TrialSource, TrialStatus } from "@/app/generated/prisma/client";

export type EntitlementFeature =
  | "hasLeads"
  | "hasVerifiedBadge"
  | "hasAnalytics"
  | "hasPriorityRanking";

export interface InstituteEntitlementInput {
  id: string;
  subscriptionPlan: SubscriptionPlan;
  planWeight: number;
  planExpiresAt: Date | null;
  isVerified: boolean;
  hasUsedTrial: boolean;
}

export interface ActiveTrialInput {
  id: string;
  status: TrialStatus;
  source: TrialSource;
  startedAt: Date | null;
  expiresAt: Date | null;
}

export interface InstituteEntitlements {
  instituteId: string;
  effectivePlan: PlanType;
  displayName: string;
  limits: (typeof PLAN_LIMITS)[PlanType];
  isTrialActive: boolean;
  isPaidPlan: boolean;
  hasVerifiedBadge: boolean;
  hasUsedTrial: boolean;
  canActivateTrial: boolean;
  expiresAt: Date | null;
  daysRemaining: number | null;
  activeTrial: ActiveTrialInput | null;
}

export class EntitlementError extends Error {
  public readonly statusCode: number;
  public readonly requiredFeature: string;

  constructor(message: string, requiredFeature: string, statusCode = 403) {
    super(message);
    this.name = "EntitlementError";
    this.statusCode = statusCode;
    this.requiredFeature = requiredFeature;
  }
}

function computeDaysRemaining(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  const diffMs = expiresAt.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Pure entitlement resolver (single source of truth).
 * Precedence:
 * 1. Valid paid subscription (takes precedence over any stray trial)
 * 2. Valid active trial (status === "ACTIVE" && expiresAt > now) -> ULTRA
 * 3. BASIC fallback
 */
export function resolveInstituteEntitlements(params: {
  institute: InstituteEntitlementInput;
  activeTrial: ActiveTrialInput | null;
  now?: Date;
}): InstituteEntitlements {
  const { institute, activeTrial } = params;
  const now = params.now ?? new Date();

  const hasValidActiveTrial = Boolean(
    activeTrial &&
      activeTrial.status === "ACTIVE" &&
      activeTrial.expiresAt &&
      activeTrial.expiresAt.getTime() > now.getTime()
  );

  const hasUnexpiredInstitutePlan =
    institute.subscriptionPlan !== "BASIC" &&
    (!institute.planExpiresAt || institute.planExpiresAt.getTime() > now.getTime());

  // 1. Valid paid subscription takes precedence.
  // Note: During a normal active trial, Institute.subscriptionPlan is "ULTRA" and planExpiresAt === trial.expiresAt.
  // If subscriptionPlan is non-BASIC & unexpired and either there is no active trial OR the plan is not ULTRA (e.g. paid PREMIUM),
  // it is a paid subscription.
  if (
    hasUnexpiredInstitutePlan &&
    (!hasValidActiveTrial || institute.subscriptionPlan !== "ULTRA")
  ) {
    const plan = institute.subscriptionPlan as PlanType;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.BASIC;
    return {
      instituteId: institute.id,
      effectivePlan: plan,
      displayName: PLAN_DISPLAY_NAMES[plan] ?? plan,
      limits,
      isTrialActive: false,
      isPaidPlan: true,
      hasVerifiedBadge: institute.isVerified || limits.hasVerifiedBadge,
      hasUsedTrial: institute.hasUsedTrial,
      canActivateTrial: false,
      expiresAt: institute.planExpiresAt,
      daysRemaining: computeDaysRemaining(institute.planExpiresAt, now),
      activeTrial: null,
    };
  }

  // 2. Valid active trial grants ULTRA regardless of whether cron has run.
  if (hasValidActiveTrial && activeTrial) {
    const limits = PLAN_LIMITS.ULTRA;
    return {
      instituteId: institute.id,
      effectivePlan: "ULTRA",
      displayName: PLAN_DISPLAY_NAMES.ULTRA,
      limits,
      isTrialActive: true,
      isPaidPlan: false,
      hasVerifiedBadge: institute.isVerified || limits.hasVerifiedBadge,
      hasUsedTrial: institute.hasUsedTrial,
      canActivateTrial: false,
      expiresAt: activeTrial.expiresAt,
      daysRemaining: computeDaysRemaining(activeTrial.expiresAt, now),
      activeTrial,
    };
  }

  // 3. Fallback to BASIC
  const limits = PLAN_LIMITS.BASIC;
  return {
    instituteId: institute.id,
    effectivePlan: "BASIC",
    displayName: PLAN_DISPLAY_NAMES.BASIC,
    limits,
    isTrialActive: false,
    isPaidPlan: false,
    hasVerifiedBadge: institute.isVerified,
    hasUsedTrial: institute.hasUsedTrial,
    canActivateTrial: !institute.hasUsedTrial,
    expiresAt: null,
    daysRemaining: null,
    activeTrial: null,
  };
}

type DbClient = Pick<PrismaClient, "institute" | "instituteTrial">;

export async function getInstituteEntitlements(
  instituteId: string,
  db: DbClient = prisma,
  now: Date = new Date()
): Promise<InstituteEntitlements | null> {
  const [institute, activeTrial] = await Promise.all([
    db.institute.findUnique({
      where: { id: instituteId },
      select: {
        id: true,
        subscriptionPlan: true,
        planWeight: true,
        planExpiresAt: true,
        isVerified: true,
        hasUsedTrial: true,
      },
    }),
    db.instituteTrial.findFirst({
      where: { instituteId, status: "ACTIVE" },
      select: {
        id: true,
        status: true,
        source: true,
        startedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  if (!institute) return null;

  return resolveInstituteEntitlements({ institute, activeTrial, now });
}

export async function assertInstituteFeature(
  instituteId: string,
  feature: EntitlementFeature,
  db: DbClient = prisma
): Promise<InstituteEntitlements> {
  const entitlements = await getInstituteEntitlements(instituteId, db);
  if (!entitlements) {
    throw new EntitlementError("Institute not found", feature, 404);
  }
  if (!entitlements.limits[feature]) {
    throw new EntitlementError(
      `Your current ${entitlements.displayName} plan does not include ${feature}. Upgrade to unlock this feature.`,
      feature,
      403
    );
  }
  return entitlements;
}
