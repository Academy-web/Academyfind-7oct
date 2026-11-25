jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/notifications/salesNotifications", () => ({
  notifySalesManagerOnPlanUpgrade: jest.fn(),
}));
jest.mock("@/scripts/SyncInstitute", () => ({
  syncSingleInstituteToMeili: jest.fn().mockResolvedValue({ success: true }),
}));

const mockPrisma: any = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn().mockResolvedValue([]),
  institute: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  instituteTrial: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  subscriptionPayment: { findUnique: jest.fn(), updateMany: jest.fn() },
  trialAuditLog: { create: jest.fn() },
  outboxEvent: { create: jest.fn(), update: jest.fn() },
  webhookEvent: { createMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  instituteManager: { findUnique: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { signTrialCookie, verifyTrialCookie } from "@/lib/subscription/trialCookie";
import {
  adminExtendTrial,
  createOrReusePendingTrial,
  generateTrialToken,
} from "@/lib/subscription/trial";
import {
  APPROVAL_WITH_TRIAL_SUBJECT,
  buildApprovalWithTrialEmailHtml,
} from "@/lib/notifications/trialEmails";
import { approvePayment } from "@/lib/User/admin/adminPaymentApprove";
import { GET as openTrialGet } from "@/app/api/trial/open/route";
import { POST as resendWebhookPost } from "@/app/api/webhooks/resend/route";

describe("Phase 2-4 Lifecycle, Security & Email Verification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  });

  it("1. Scanner GET /api/trial/open logs access, sets HttpOnly cookie, strips token, never activates", async () => {
    const { rawToken, tokenHash } = generateTrialToken();
    mockPrisma.instituteTrial.findUnique.mockResolvedValue({
      id: "tr_1",
      instituteId: "inst_1",
      status: "PENDING",
      tokenExpiresAt: new Date(Date.now() + 86400_000),
      linkAccessedAt: null,
      startedAt: null,
      expiresAt: null,
      institute: { id: "inst_1", name: "Test Acad", slug: "test-acad", subscriptionPlan: "BASIC", hasUsedTrial: false },
    });
    mockPrisma.instituteTrial.update.mockResolvedValue({});

    const req = new Request(`https://academyfind.com/api/trial/open?token=${rawToken}`);
    const res = await openTrialGet(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://academyfind.com/trial/activate");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toContain("af_trial_ctx=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    // Must NEVER flip hasUsedTrial or update Institute on GET
    expect(mockPrisma.institute.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.institute.update).not.toHaveBeenCalled();
    expect(mockPrisma.instituteTrial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tr_1" },
        data: expect.objectContaining({ accessCount: { increment: 1 } }),
      })
    );
    expect(tokenHash).toHaveLength(64);
  });

  it("2. Trial cookie rejects tampering", () => {
    const signed = signTrialCookie({ tokenHash: "abc123", instituteId: "inst_1" });
    expect(verifyTrialCookie(signed)?.instituteId).toBe("inst_1");
    expect(verifyTrialCookie(signed + "tamper")).toBeNull();
  });

  it("3. PENDING trial email resend reuses existing row & keeps hasUsedTrial=false", async () => {
    mockPrisma.institute.findUnique.mockResolvedValue({
      id: "inst_1",
      subscriptionPlan: "BASIC",
      hasUsedTrial: false,
    });
    mockPrisma.instituteTrial.findFirst.mockResolvedValue({
      id: "tr_pending",
      instituteId: "inst_1",
      status: "PENDING",
      recipientEmail: "old@inst.com",
      campaignBatchId: "b1",
      tokenHash: "oldhash",
      tokenExpiresAt: new Date(),
      emailSentAt: null,
    });
    mockPrisma.instituteTrial.update.mockResolvedValue({ id: "tr_pending", status: "PENDING" });

    const res = await createOrReusePendingTrial({
      instituteId: "inst_1",
      source: "EMAIL_CAMPAIGN",
      recipientEmail: "new@inst.com",
      campaignBatchId: "b2",
      tokenHash: "newhash",
      markEmailSent: true,
    });

    expect(res.success).toBe(true);
    expect((res as any).reused).toBe(true);
    expect(mockPrisma.instituteTrial.create).not.toHaveBeenCalled();
    expect(mockPrisma.institute.update).not.toHaveBeenCalled();
  });

  it("4. Admin extension beyond 14 total days from startedAt is rejected", async () => {
    const startedAt = new Date("2026-11-01T00:00:00.000Z");
    const expiresAt = new Date("2026-11-12T00:00:00.000Z"); // Day 11
    mockPrisma.instituteTrial.findUnique.mockResolvedValue({
      id: "tr_active",
      instituteId: "inst_1",
      status: "ACTIVE",
      startedAt,
      expiresAt,
    });

    // +4 days -> Day 15 (> 14 days max)
    const rejected = await adminExtendTrial({
      trialId: "tr_active",
      adminUserId: "admin_1",
      additionalDays: 4,
      reason: "Extra days requested",
    });
    expect(rejected.success).toBe(false);
    expect(rejected.code).toBe("MAX_EXTENSION_EXCEEDED");

    // +3 days -> Day 14 (allowed)
    const allowed = await adminExtendTrial({
      trialId: "tr_active",
      adminUserId: "admin_1",
      additionalDays: 3,
      reason: "Within 14-day cap",
    });
    expect(allowed.success).toBe(true);
    expect(mockPrisma.trialAuditLog.create).toHaveBeenCalled();
  });

  it("5. approvePayment converts ACTIVE trial atomically and enqueues OutboxEvent", async () => {
    mockPrisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: "pay_1",
      instituteId: "inst_1",
      userId: "usr_1",
      planRequested: "PREMIUM",
      billingCycle: "ANNUAL",
      amountPaid: 4999,
      status: "PENDING",
      institute: { id: "inst_1", name: "Test Acad" },
    });
    mockPrisma.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.instituteTrial.findFirst.mockResolvedValue({ id: "tr_active" });
    mockPrisma.instituteTrial.updateMany.mockResolvedValue({ count: 1 });

    const res = await approvePayment("pay_1", "admin_1");
    expect(res.success).toBe(true);
    expect(mockPrisma.institute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inst_1" },
        data: expect.objectContaining({ subscriptionPlan: "PREMIUM", planWeight: 3, isVerified: true }),
      })
    );
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "MEILISEARCH_SYNC_INSTITUTE",
          aggregateId: "inst_1",
        }),
      })
    );
  });

  it("6. Resend webhook deduplicates already COMPLETED events", async () => {
    mockPrisma.webhookEvent.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.webhookEvent.findUnique.mockResolvedValue({
      id: "wh_1",
      provider: "resend",
      providerEventId: "evt_1:email.delivered",
      status: "COMPLETED",
    });

    const req = new Request("https://academyfind.com/api/webhooks/resend", {
      method: "POST",
      headers: { "svix-id": "evt_1", "content-type": "application/json" },
      body: JSON.stringify({ type: "email.delivered", data: { email_id: "evt_1", to: ["a@b.com"] } }),
    });
    const res = await resendWebhookPost(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.deduplicated).toBe(true);
    expect(mockPrisma.webhookEvent.updateMany).not.toHaveBeenCalled();
  });

  it("7. Approval email template includes both URLs, trial copy, and zero raw asterisks", () => {
    const html = buildApprovalWithTrialEmailHtml({
      instituteName: "Apex Academy",
      publicListingUrl: "https://www.academyfind.com/institute/123-apex",
      managerDashboardUrl: "https://www.academyfind.com/manager/123",
    });

    expect(APPROVAL_WITH_TRIAL_SUBJECT).toBe(
      "Your Institute Is Now Live on AcademyFind – Explore Your 7-Day Free Trial!"
    );
    expect(html).toContain("https://www.academyfind.com/institute/123-apex");
    expect(html).toContain("https://www.academyfind.com/manager/123");
    expect(html).toContain("Your 7-Day Free Trial Is Waiting!");
    expect(html).toContain("9045699938");
    expect(html).not.toContain("*");
  });
});
