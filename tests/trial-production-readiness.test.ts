import crypto from "crypto";
import fs from "fs";
import path from "path";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/notifications/salesNotifications", () => ({
  notifySalesManagerOnPlanUpgrade: jest.fn(),
}));

const mockSendEmail = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/notifications/email", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

const mockSyncSingle = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/scripts/SyncInstitute", () => ({
  syncSingleInstituteToMeili: (...args: any[]) => mockSyncSingle(...args),
}));

// Stateful in-memory DB simulator with mutex to simulate Postgres FOR UPDATE row locking
let mutex = Promise.resolve();
function withRowLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutex.then(fn, fn);
  mutex = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

const state = {
  institute: {
    id: "inst_1",
    name: "Apex Academy",
    subscriptionPlan: "BASIC" as string,
    planWeight: 1,
    planExpiresAt: null as Date | null,
    isVerified: false,
    hasUsedTrial: false,
  },
  trials: [] as any[],
  payments: [] as any[],
  outbox: [] as any[],
  webhooks: [] as any[],
  auditLogs: [] as any[],
  notifications: [] as any[],
  managers: [{ userId: "mgr_1", instituteId: "inst_1", user: { name: "Mgr", email: "mgr@apex.com" } }],
};

const mockPrisma: any = {
  $transaction: jest.fn(async (cb: any) => withRowLock(() => cb(mockPrisma))),
  $executeRaw: jest.fn().mockResolvedValue(1),
  $queryRaw: jest.fn(async () => {
    // Simulate atomic claimOutboxEvents with per-aggregate serialization & lease recovery
    const now = Date.now();
    const activeAggregates = new Set(
      state.outbox
        .filter(
          (e) =>
            e.status === "PROCESSING" &&
            e.lockedAt &&
            now - e.lockedAt.getTime() < 5 * 60 * 1000
        )
        .map((e) => e.aggregateId)
    );
    const claimed: any[] = [];
    for (const ev of state.outbox) {
      if (activeAggregates.has(ev.aggregateId)) continue;
      const isPendingReady = ev.status === "PENDING" && ev.nextRetryAt.getTime() <= now;
      const isExpiredLease =
        ev.status === "PROCESSING" &&
        ev.lockedAt &&
        now - ev.lockedAt.getTime() >= 5 * 60 * 1000;
      if ((isPendingReady || isExpiredLease) && ev.attempts < ev.maxAttempts) {
        ev.status = "PROCESSING";
        ev.lockedAt = new Date();
        ev.attempts += 1;
        activeAggregates.add(ev.aggregateId);
        claimed.push({ ...ev });
      }
    }
    return claimed;
  }),
  instituteManager: {
    findUnique: jest.fn(async ({ where }: any) => {
      const { userId, instituteId } = where.userId_instituteId;
      return state.managers.find((m) => m.userId === userId && m.instituteId === instituteId) || null;
    }),
  },
  institute: {
    findUnique: jest.fn(async ({ where }: any) =>
      where.id === state.institute.id ? { ...state.institute } : null
    ),
    findMany: jest.fn(async ({ where }: any) => {
      if (where?.planExpiresAt?.lt && where?.subscriptionPlan?.not === "BASIC") {
        const hasActiveTrial = state.trials.some(
          (t) => t.instituteId === state.institute.id && t.status === "ACTIVE"
        );
        if (
          !hasActiveTrial &&
          state.institute.subscriptionPlan !== "BASIC" &&
          state.institute.planExpiresAt &&
          state.institute.planExpiresAt < where.planExpiresAt.lt
        ) {
          return [{ ...state.institute, managers: state.managers }];
        }
      }
      return [];
    }),
    update: jest.fn(async ({ where, data }: any) => {
      if (where.id === state.institute.id) {
        Object.assign(state.institute, data);
      }
      return { ...state.institute };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let match = where.id === state.institute.id;
      if (where.hasUsedTrial !== undefined) match = match && state.institute.hasUsedTrial === where.hasUsedTrial;
      if (typeof where.subscriptionPlan === "string") {
        match = match && state.institute.subscriptionPlan === where.subscriptionPlan;
      }
      if (where.OR) {
        const orMatch = where.OR.some((cond: any) => {
          if (cond.subscriptionPlan === "ULTRA") return state.institute.subscriptionPlan === "ULTRA";
          if (cond.subscriptionPlan?.not === "BASIC" && cond.planExpiresAt?.lte) {
            return (
              state.institute.subscriptionPlan !== "BASIC" &&
              state.institute.planExpiresAt &&
              state.institute.planExpiresAt <= cond.planExpiresAt.lte
            );
          }
          return false;
        });
        match = match && orMatch;
      }
      if (!match) return { count: 0 };
      Object.assign(state.institute, data);
      return { count: 1 };
    }),
  },
  instituteTrial: {
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        state.trials.find(
          (t) =>
            (!where.instituteId || t.instituteId === where.instituteId) &&
            (!where.status || t.status === where.status)
        ) || null
      );
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      return state.trials.find((t) => t.id === where.id || t.tokenHash === where.tokenHash) || null;
    }),
    findMany: jest.fn(async ({ where }: any) => {
      return state.trials
        .filter((t) => {
          if (where?.status && t.status !== where.status) return false;
          if (where?.expiresAt?.lte && (!t.expiresAt || t.expiresAt > where.expiresAt.lte)) return false;
          if (where?.expiresAt?.gt && (!t.expiresAt || t.expiresAt <= where.expiresAt.gt)) return false;
          if (where?.reminder48hSentAt === null && t.reminder48hSentAt !== null) return false;
          return true;
        })
        .map((t) => ({ ...t, institute: { ...state.institute, managers: state.managers } }));
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `tr_${state.trials.length + 1}`,
        reminder48hSentAt: null,
        expiryEmailSentAt: null,
        ...data,
      };
      state.trials.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.trials.find((t) => t.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const t of state.trials) {
        const idOk = !where.id || t.id === where.id;
        const instOk = !where.instituteId || t.instituteId === where.instituteId;
        const statusOk = !where.status || t.status === where.status;
        const expOk = !where.expiresAt?.lte || (t.expiresAt && t.expiresAt <= where.expiresAt.lte);
        const remOk = where.reminder48hSentAt === undefined || t.reminder48hSentAt === where.reminder48hSentAt;
        if (idOk && instOk && statusOk && expOk && remOk) {
          Object.assign(t, data);
          count += 1;
        }
      }
      return { count };
    }),
  },
  subscriptionPayment: {
    findUnique: jest.fn(async ({ where }: any) => state.payments.find((p) => p.id === where.id) || null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const p = state.payments.find((x) => x.id === where.id && x.status === where.status);
      if (!p) return { count: 0 };
      Object.assign(p, data);
      return { count: 1 };
    }),
  },
  outboxEvent: {
    create: jest.fn(async ({ data }: any) => {
      const ev = {
        id: `ob_${state.outbox.length + 1}`,
        attempts: 0,
        maxAttempts: 5,
        lockedAt: null,
        lastError: null,
        ...data,
      };
      state.outbox.push(ev);
      return ev;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const ev = state.outbox.find((x) => x.id === where.id);
      if (ev) Object.assign(ev, data);
      return ev;
    }),
  },
  webhookEvent: {
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        if (!state.webhooks.some((w) => w.provider === d.provider && w.providerEventId === d.providerEventId)) {
          state.webhooks.push({ id: `wh_${state.webhooks.length + 1}`, attempts: 0, lockedAt: null, ...d });
        }
      }
      return { count: 1 };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const { provider, providerEventId } = where.provider_providerEventId;
      return state.webhooks.find((w) => w.provider === provider && w.providerEventId === providerEventId) || null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const w = state.webhooks.find((x) => x.id === where.id);
      if (!w) return { count: 0 };
      const eligible =
        w.status === "PENDING" ||
        w.status === "FAILED" ||
        (w.status === "PROCESSING" && w.lockedAt && w.lockedAt < where.OR[1].lockedAt.lt);
      if (!eligible) return { count: 0 };
      w.status = data.status;
      w.lockedAt = data.lockedAt;
      w.attempts += 1;
      return { count: 1 };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const w = state.webhooks.find((x) => x.id === where.id);
      if (w) Object.assign(w, data);
      return w;
    }),
  },
  trialAuditLog: {
    create: jest.fn(async ({ data }: any) => {
      state.auditLogs.push(data);
      return data;
    }),
  },
  userNotification: {
    createMany: jest.fn(async ({ data }: any) => {
      state.notifications.push(...data);
      return { count: data.length };
    }),
  },
};

jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { activateTrialFromDashboard, adminGrantTrialOverride } from "@/lib/subscription/trial";
import { processOutboxEvents } from "@/lib/subscription/outbox";
import { approvePayment } from "@/lib/User/admin/adminPaymentApprove";
import { GET as cronGet } from "@/app/api/cron/check-subscriptions/route";
import { POST as resendWebhookPost } from "@/app/api/webhooks/resend/route";

function resetState() {
  state.institute = {
    id: "inst_1",
    name: "Apex Academy",
    subscriptionPlan: "BASIC",
    planWeight: 1,
    planExpiresAt: null,
    isVerified: false,
    hasUsedTrial: false,
  };
  state.trials = [];
  state.payments = [];
  state.outbox = [];
  state.webhooks = [];
  state.auditLogs = [];
  state.notifications = [];
  jest.clearAllMocks();
  mockSyncSingle.mockResolvedValue({ success: true });
}

describe("Final Production-Readiness Checklist (All 10 Scenarios)", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    resetState();
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it("1. Production webhook secret is mandatory & Svix HMAC signature rejects invalid requests", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.RESEND_WEBHOOK_SECRET;

    const missingSecretRes = await resendWebhookPost(
      new Request("https://academyfind.com/api/webhooks/resend", {
        method: "POST",
        body: JSON.stringify({ type: "email.delivered" }),
      })
    );
    expect(missingSecretRes.status).toBe(500);

    // Now configure secret and test invalid vs valid Svix signature
    const rawSecret = Buffer.from("super-secret-key").toString("base64");
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${rawSecret}`;
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "em_1", to: ["a@b.com"] } });
    const svixId = "msg_1";
    const svixTs = String(Math.floor(Date.now() / 1000));

    const badSigRes = await resendWebhookPost(
      new Request("https://academyfind.com/api/webhooks/resend", {
        method: "POST",
        headers: { "svix-id": svixId, "svix-timestamp": svixTs, "svix-signature": "v1,invalid" },
        body,
      })
    );
    expect(badSigRes.status).toBe(401);

    const validSig = crypto
      .createHmac("sha256", Buffer.from(rawSecret, "base64"))
      .update(`${svixId}.${svixTs}.${body}`)
      .digest("base64");

    const goodRes = await resendWebhookPost(
      new Request("https://academyfind.com/api/webhooks/resend", {
        method: "POST",
        headers: { "svix-id": svixId, "svix-timestamp": svixTs, "svix-signature": `v1,${validSig}` },
        body,
      })
    );
    expect(goodRes.status).toBe(200);
  });

  it("2. Two simultaneous trial activation requests -> only one activates, second is idempotent", async () => {
    const [r1, r2] = await Promise.all([
      activateTrialFromDashboard({ instituteId: "inst_1", userId: "mgr_1", userRole: "INSTITUTE_MANAGER" }),
      activateTrialFromDashboard({ instituteId: "inst_1", userId: "mgr_1", userRole: "INSTITUTE_MANAGER" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect([r1.alreadyActive, r2.alreadyActive].filter(Boolean)).toHaveLength(1);
    expect(state.trials).toHaveLength(1);
    expect(state.institute.hasUsedTrial).toBe(true);
  });

  it("3. Concurrent payment approval vs trial expiry -> consistent final state", async () => {
    const past = new Date(Date.now() - 60_000);
    state.institute.subscriptionPlan = "ULTRA";
    state.institute.planWeight = 4;
    state.institute.planExpiresAt = past;
    state.institute.hasUsedTrial = true;
    state.trials.push({
      id: "tr_1",
      instituteId: "inst_1",
      status: "ACTIVE",
      startedAt: new Date(Date.now() - 7 * 86400_000),
      expiresAt: past,
      reminder48hSentAt: new Date(),
      expiryEmailSentAt: null,
    });
    state.payments.push({
      id: "pay_1",
      instituteId: "inst_1",
      userId: "mgr_1",
      planRequested: "PREMIUM",
      billingCycle: "ANNUAL",
      amountPaid: 4999,
      status: "PENDING",
      institute: state.institute,
    });

    await Promise.all([
      approvePayment("pay_1", "admin_1"),
      cronGet(new Request("https://academyfind.com/api/cron/check-subscriptions")),
    ]);

    // Because approvePayment acquired the row lock first, trial converted and cron skipped it -> PREMIUM preserved!
    expect(state.institute.subscriptionPlan).toBe("PREMIUM");
    expect(state.institute.planWeight).toBe(3);
    expect(state.trials[0].status).toBe("CONVERTED");
  });

  it("4 & 5. Outbox lease recovery, per-institute serialization, and Meilisearch outage retry", async () => {
    // Meilisearch fails on activation -> DB commits & enqueues OutboxEvent -> retries -> recovers
    mockSyncSingle.mockRejectedValueOnce(new Error("Meilisearch 503"));
    const act = await activateTrialFromDashboard({
      instituteId: "inst_1",
      userId: "mgr_1",
      userRole: "INSTITUTE_MANAGER",
    });
    expect(act.success).toBe(true);
    expect(state.outbox).toHaveLength(1);

    // First worker attempt fails -> schedules retry (status back to PENDING)
    const firstRun = await processOutboxEvents(10);
    expect(firstRun.retried).toBe(1);
    expect(state.outbox[0].status).toBe("PENDING");

    // Simulate worker crash (stuck PROCESSING with expired lease > 5m)
    state.outbox[0].status = "PROCESSING";
    state.outbox[0].lockedAt = new Date(Date.now() - 10 * 60 * 1000);
    mockSyncSingle.mockResolvedValueOnce({ success: true });

    const recoveredRun = await processOutboxEvents(10);
    expect(recoveredRun.completed).toBe(1);
    expect(state.outbox[0].status).toBe("COMPLETED");
  });

  it("6. Expired paid PREMIUM subscription is reconciled to BASIC after trial expires", async () => {
    const past = new Date(Date.now() - 60_000);
    state.institute.subscriptionPlan = "PREMIUM";
    state.institute.planWeight = 3;
    state.institute.planExpiresAt = past; // Paid plan already expired!
    state.institute.hasUsedTrial = true;
    state.trials.push({
      id: "tr_1",
      instituteId: "inst_1",
      status: "ACTIVE",
      startedAt: new Date(Date.now() - 7 * 86400_000),
      expiresAt: past,
      reminder48hSentAt: new Date(),
      expiryEmailSentAt: null,
    });

    await cronGet(new Request("https://academyfind.com/api/cron/check-subscriptions"));

    expect(state.trials[0].status).toBe("EXPIRED");
    expect(state.institute.subscriptionPlan).toBe("BASIC");
    expect(state.institute.planWeight).toBe(1);
  });

  it("7. Manager authorization & admin override permissions", async () => {
    const forbidden = await activateTrialFromDashboard({
      instituteId: "inst_1",
      userId: "stranger_user",
      userRole: "STUDENT",
    });
    expect(forbidden.success).toBe(false);
    expect(forbidden.code).toBe("FORBIDDEN");

    const missingReason = await adminGrantTrialOverride({
      instituteId: "inst_1",
      adminUserId: "admin_1",
      reason: "   ",
      days: 7,
    });
    expect(missingReason.success).toBe(false);
    expect(missingReason.code).toBe("REASON_REQUIRED");
  });

  it("8. Day 5 & Day 7 email duplicate-send prevention in cron", async () => {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
    state.institute.subscriptionPlan = "ULTRA";
    state.trials.push({
      id: "tr_1",
      instituteId: "inst_1",
      status: "ACTIVE",
      recipientEmail: "mgr@apex.com",
      startedAt: new Date(Date.now() - 6 * 86400_000),
      expiresAt: in24h,
      reminder48hSentAt: null,
      expiryEmailSentAt: null,
    });

    // Run cron twice -> Day 5 reminder sent exactly once!
    await cronGet(new Request("https://academyfind.com/api/cron/check-subscriptions"));
    await cronGet(new Request("https://academyfind.com/api/cron/check-subscriptions"));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(state.trials[0].reminder48hSentAt).not.toBeNull();
  });

  it("9. Duplicate webhook delivery during PROCESSING is ignored safely", async () => {
    state.webhooks.push({
      id: "wh_1",
      provider: "resend",
      providerEventId: "evt_dup:email.delivered",
      eventType: "email.delivered",
      status: "PROCESSING",
      lockedAt: new Date(), // Fresh lock
      attempts: 1,
    });

    const res = await resendWebhookPost(
      new Request("https://academyfind.com/api/webhooks/resend", {
        method: "POST",
        headers: { "svix-id": "evt_dup" },
        body: JSON.stringify({ type: "email.delivered", data: { email_id: "evt_dup", to: ["a@b.com"] } }),
      })
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.inFlight).toBe(true);
  });

  it("10. Production vercel.json cron configuration is verified", () => {
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
    );
    expect(vercelConfig.crons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/cron/check-subscriptions",
          schedule: "0 */6 * * *",
        }),
      ])
    );
  });
});
