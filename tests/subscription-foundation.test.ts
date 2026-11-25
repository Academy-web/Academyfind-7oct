jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  EntitlementError,
  assertInstituteFeature,
  resolveInstituteEntitlements,
} from "@/lib/subscription/entitlements";
import { computeBackoffMs } from "@/lib/subscription/outbox";
import { generateTrialToken, hashTrialToken } from "@/lib/subscription/trial";

describe("Phase 1: Subscription Foundation", () => {
  const now = new Date("2026-11-26T10:00:00.000Z");
  const future = new Date("2026-12-03T10:00:00.000Z");
  const past = new Date("2026-11-25T10:00:00.000Z");

  describe("resolveInstituteEntitlements precedence & live expiry", () => {
    it("1. PREMIUM paid + ACTIVE trial -> PREMIUM entitlement (paid wins)", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_1",
          subscriptionPlan: "PREMIUM",
          planWeight: 3,
          planExpiresAt: future,
          isVerified: true,
          hasUsedTrial: true,
        },
        activeTrial: {
          id: "trial_1",
          status: "ACTIVE",
          source: "EMAIL_CAMPAIGN",
          startedAt: past,
          expiresAt: future,
        },
        now,
      });

      expect(result.effectivePlan).toBe("PREMIUM");
      expect(result.isPaidPlan).toBe(true);
      expect(result.isTrialActive).toBe(false);
    });

    it("2. Expired paid plan + valid ACTIVE trial -> ULTRA entitlement", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_2",
          subscriptionPlan: "PREMIUM",
          planWeight: 3,
          planExpiresAt: past,
          isVerified: false,
          hasUsedTrial: true,
        },
        activeTrial: {
          id: "trial_2",
          status: "ACTIVE",
          source: "ADMIN_GRANT",
          startedAt: past,
          expiresAt: future,
        },
        now,
      });

      expect(result.effectivePlan).toBe("ULTRA");
      expect(result.isTrialActive).toBe(true);
      expect(result.isPaidPlan).toBe(false);
      expect(result.limits.hasPriorityRanking).toBe(true);
      expect(result.limits.hasLeads).toBe(true);
    });

    it("3. Normal active trial (ULTRA + ACTIVE) -> ULTRA with isTrialActive=true", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_3",
          subscriptionPlan: "ULTRA",
          planWeight: 4,
          planExpiresAt: future,
          isVerified: false,
          hasUsedTrial: true,
        },
        activeTrial: {
          id: "trial_3",
          status: "ACTIVE",
          source: "EMAIL_CAMPAIGN",
          startedAt: now,
          expiresAt: future,
        },
        now,
      });

      expect(result.effectivePlan).toBe("ULTRA");
      expect(result.isTrialActive).toBe(true);
      expect(result.isPaidPlan).toBe(false);
      expect(result.daysRemaining).toBe(7);
      expect(result.hasVerifiedBadge).toBe(true);
    });

    it("4. Expired trial where cron has NOT run yet -> BASIC entitlement (live expiry check)", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_4",
          subscriptionPlan: "ULTRA",
          planWeight: 4,
          planExpiresAt: past,
          isVerified: false,
          hasUsedTrial: true,
        },
        activeTrial: {
          id: "trial_4",
          status: "ACTIVE",
          source: "NEW_CLAIM",
          startedAt: new Date("2026-11-18T10:00:00.000Z"),
          expiresAt: past,
        },
        now,
      });

      expect(result.effectivePlan).toBe("BASIC");
      expect(result.isTrialActive).toBe(false);
      expect(result.isPaidPlan).toBe(false);
      expect(result.canActivateTrial).toBe(false);
      expect(result.hasVerifiedBadge).toBe(false);
      expect(result.limits.hasLeads).toBe(false);
    });

    it("5. Paid ULTRA after conversion (no ACTIVE trial) -> ULTRA with isPaidPlan=true", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_5",
          subscriptionPlan: "ULTRA",
          planWeight: 4,
          planExpiresAt: future,
          isVerified: true,
          hasUsedTrial: true,
        },
        activeTrial: null,
        now,
      });

      expect(result.effectivePlan).toBe("ULTRA");
      expect(result.isPaidPlan).toBe(true);
      expect(result.isTrialActive).toBe(false);
    });

    it("6. BASIC with hasUsedTrial=false -> canActivateTrial=true", () => {
      const result = resolveInstituteEntitlements({
        institute: {
          id: "inst_6",
          subscriptionPlan: "BASIC",
          planWeight: 1,
          planExpiresAt: null,
          isVerified: false,
          hasUsedTrial: false,
        },
        activeTrial: null,
        now,
      });

      expect(result.effectivePlan).toBe("BASIC");
      expect(result.canActivateTrial).toBe(true);
    });
  });

  describe("assertInstituteFeature backend enforcement", () => {
    it("throws EntitlementError(403) when BASIC accesses ULTRA feature", async () => {
      const mockDb = {
        institute: {
          findUnique: jest.fn().mockResolvedValue({
            id: "inst_basic",
            subscriptionPlan: "BASIC",
            planWeight: 1,
            planExpiresAt: null,
            isVerified: false,
            hasUsedTrial: false,
          }),
        },
        instituteTrial: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(assertInstituteFeature("inst_basic", "hasLeads", mockDb)).rejects.toThrow(
        EntitlementError
      );
    });
  });

  describe("Outbox backoff & Token hashing", () => {
    it("computes bounded exponential backoff with jitter", () => {
      expect(computeBackoffMs(1, () => 0)).toBe(30_000);
      expect(computeBackoffMs(2, () => 0)).toBe(60_000);
      expect(computeBackoffMs(3, () => 0.5)).toBe(125_000);
      expect(computeBackoffMs(10, () => 0)).toBe(3_600_000);
    });

    it("generates unique tokens and deterministic SHA-256 hashes", () => {
      const a = generateTrialToken();
      const b = generateTrialToken();
      expect(a.rawToken).not.toBe(b.rawToken);
      expect(a.tokenHash).toBe(hashTrialToken(a.rawToken));
      expect(a.tokenHash).toHaveLength(64);
    });
  });
});
