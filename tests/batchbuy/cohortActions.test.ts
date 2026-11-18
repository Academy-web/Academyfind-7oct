jest.mock("../../app/generated/prisma/client", () => ({
  Prisma: {
    TransactionIsolationLevel: {
      Serializable: "Serializable",
    },
    PrismaClientKnownRequestError: class MockPrismaError extends Error {
      code = "";
    },
  },
}));

import {
  createBatchBuyCohort,
  joinBatchBuyCohort,
  leaveBatchBuyCohort,
  syncMyCohortPhoneVerification,
} from "../../lib/batchbuy/cohortActions";
import { getCohortDetailsByCode } from "../../lib/batchbuy/cohortQueries";
import { auth } from "../../lib/auth/auth";
import { prisma } from "../../lib/prisma";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("../../lib/auth/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("../../lib/notifications/notify", () => ({
  notifyUser: jest.fn(async () => null),
}));

jest.mock("../../lib/batchbuy/redemptionAuth", () => ({
  writeBatchBuyAuditLogTx: jest.fn(async () => ({ id: "audit_cohort_1" })),
}));

jest.mock("../../lib/batchbuy/slabResolver", () => ({
  resolveEffectiveDiscountSlabs: jest.fn(async () => ({
    scope: "INSTITUTE_DEFAULT",
    slabs: [
      {
        id: "slab_1",
        instituteId: "inst_allen",
        batchId: null,
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 8,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
      },
    ],
  })),
}));

const mockTx = {
  $queryRaw: jest.fn(),
  groupAdmissionCohort: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  groupCohortMember: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  studentProfile: {
    upsert: jest.fn(),
  },
  conversation: {
    create: jest.fn(),
    update: jest.fn(),
  },
  conversationParticipant: {
    create: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  message: {
    create: jest.fn(),
  },
};

jest.mock("../../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    institute: {
      findUnique: jest.fn(),
    },
    instituteBatch: {
      findFirst: jest.fn(),
    },
    groupCohortMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    groupAdmissionCohort: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

describe("BatchBuy Slice 2 — Cohort Actions, Concurrency & Privacy", () => {
  const baseIntent = {
    confirmIntent: true,
    targetExam: "JEE",
    targetAcademicYear: 2027,
    currentClass: "Class 11",
    isMinor: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Requires authentication to create or join a cohort", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);

    const createRes = await createBatchBuyCohort({
      instituteId: "inst_allen",
      batchId: "batch_1",
      title: "Allen JEE Nurture 2027",
      examCategory: "JEE",
      targetAcademicYear: 2027,
      minRequired: 5,
      targetSize: 10,
      maxCapacity: 25,
      formingDays: 14,
      intent: baseIntent,
    });
    expect(createRes.success).toBe(false);
    expect(createRes.requiresAuth).toBe(true);

    const joinRes = await joinBatchBuyCohort({
      cohortId: "cohort_1",
      intent: baseIntent,
    });
    expect(joinRes.success).toBe(false);
    expect(joinRes.requiresAuth).toBe(true);
  });

  test("Creates cohort, dedicated Conversation, ConversationParticipant & INTENT_VERIFIED creator member", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_1" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_1",
      name: "Aarav Sharma",
      username: "aarav",
      isActive: true,
      phoneVerified: true,
    });
    (prisma.institute.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "inst_allen",
      name: "Allen Career Institute",
      slug: "allen-kota",
      city: { name: "Kota" },
      managers: [{ userId: "mgr_1" }],
    });
    (prisma.instituteBatch.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "batch_1",
      name: "Nurture Batch A",
    });

    mockTx.groupCohortMember.findFirst.mockResolvedValueOnce(null);
    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce(null);
    mockTx.conversation.create.mockResolvedValueOnce({ id: "conv_100" });
    mockTx.groupAdmissionCohort.create.mockImplementationOnce(async ({ data }: any) => ({
      id: "cohort_100",
      cohortCode: data.cohortCode,
    }));
    mockTx.message.create.mockResolvedValueOnce({ id: "msg_1" });

    const res = await createBatchBuyCohort({
      instituteId: "inst_allen",
      batchId: "batch_1",
      title: "Allen Nurture JEE 2027",
      examCategory: "JEE",
      targetAcademicYear: 2027,
      minRequired: 5,
      targetSize: 10,
      maxCapacity: 25,
      formingDays: 14,
      intent: baseIntent,
    });

    expect(res.success).toBe(true);
    expect(res.stage).toBe("INTENT_VERIFIED");
    expect(res.conversationId).toBe("conv_100");
    // Serialized via user FOR UPDATE lock inside tx before duplicate check
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "GROUP",
          isStudyGroup: false,
          instituteId: "inst_allen",
          batchId: "batch_1",
        }),
      })
    );
    expect(mockTx.conversationParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv_100",
          userId: "user_1",
          role: "ADMIN",
        }),
      })
    );
    expect(mockTx.groupCohortMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneVerified: true,
          profileConfirmed: true,
          stage: "INTENT_VERIFIED",
          parentNotifiedAt: null,
          parentConsentVerifiedAt: null,
        }),
      })
    );
  });

  test("Assigns INTERESTED stage when phone OTP is not yet verified, and upgrades via sync", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_2" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_2",
      name: "Priya Verma",
      username: "priya",
      isActive: true,
      phoneVerified: false,
    });

    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_1",
      cohortCode: "BB-ALLEN-KOTA-7K3M",
      title: "Allen JEE",
      instituteId: "inst_allen",
      batchId: "batch_1",
      status: "FORMING",
      formingExpiresAt: new Date(Date.now() + 86400000),
      maxCapacity: 25,
      minRequired: 5,
      targetSize: 10,
      createdById: "user_1",
      conversationId: "conv_1",
      institute: { id: "inst_allen", slug: "allen-kota", name: "Allen" },
      batch: { id: "batch_1", name: "Nurture" },
      members: [{ id: "m1", userId: "user_1", stage: "INTENT_VERIFIED" }],
    });
    mockTx.groupCohortMember.findFirst.mockResolvedValueOnce(null);
    mockTx.message.create.mockResolvedValueOnce({ id: "msg_join" });

    // For refresh details query after join
    (prisma.groupAdmissionCohort.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const joinRes = await joinBatchBuyCohort({
      cohortId: "cohort_1",
      intent: baseIntent,
    });

    expect(joinRes.success).toBe(true);
    expect(joinRes.stage).toBe("INTERESTED");
    expect(mockTx.groupCohortMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneVerified: false,
          profileConfirmed: true,
          stage: "INTERESTED",
        }),
      })
    );

    // Later, user verifies OTP and clicks sync
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_2" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ phoneVerified: true });
    (prisma.groupCohortMember.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "m2",
      stage: "INTERESTED",
      profileConfirmed: true,
      explicitIntentAt: new Date(),
      cohort: { cohortCode: "BB-ALLEN-KOTA-7K3M" },
    });

    const syncRes = await syncMyCohortPhoneVerification("cohort_1");
    expect(syncRes.success).toBe(true);
    expect(syncRes.stage).toBe("INTENT_VERIFIED");
    expect(prisma.groupCohortMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { phoneVerified: true, stage: "INTENT_VERIFIED" },
      })
    );
  });

  test("Blocks joining when cohort is at maxCapacity (concurrency row-lock protection)", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_overflow" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_overflow",
      name: "Late Joiner",
      username: "late",
      isActive: true,
      phoneVerified: true,
    });

    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_full",
      cohortCode: "BB-ALLEN-KOTA-FULL",
      title: "Full Cohort",
      instituteId: "inst_allen",
      batchId: "batch_1",
      status: "FORMING",
      formingExpiresAt: new Date(Date.now() + 86400000),
      maxCapacity: 2,
      minRequired: 2,
      targetSize: 2,
      createdById: "user_1",
      conversationId: "conv_1",
      institute: { id: "inst_allen", slug: "allen-kota", name: "Allen" },
      batch: { id: "batch_1", name: "Nurture" },
      members: [
        { id: "m1", userId: "user_1", stage: "INTENT_VERIFIED" },
        { id: "m2", userId: "user_2", stage: "INTENT_VERIFIED" },
      ],
    });

    const res = await joinBatchBuyCohort({
      cohortId: "cohort_full",
      intent: baseIntent,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/maximum capacity/);
    expect(mockTx.groupCohortMember.create).not.toHaveBeenCalled();
  });

  test("Handles creator succession when cohort creator leaves while other members remain", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_creator" },
    });

    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_1",
      cohortCode: "BB-ALLEN-KOTA-SUCC",
      status: "FORMING",
      targetSize: 10,
      createdById: "user_creator",
      conversationId: "conv_1",
      institute: { id: "inst_allen", slug: "allen" },
      members: [
        {
          id: "m1",
          userId: "user_creator",
          stage: "INTENT_VERIFIED",
          user: { name: "Creator One", username: "c1" },
        },
        {
          id: "m2",
          userId: "user_second",
          stage: "INTENT_VERIFIED",
          user: { name: "Next Leader", username: "n2" },
        },
      ],
    });
    mockTx.message.create.mockResolvedValueOnce({ id: "msg_leave" });

    const res = await leaveBatchBuyCohort("cohort_1");
    expect(res.success).toBe(true);
    expect(res.cancelled).toBe(false);
    expect(mockTx.groupCohortMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1" },
        data: { stage: "DROPPED" },
      })
    );
    expect(mockTx.groupAdmissionCohort.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cohort_1" },
        data: { createdById: "user_second" },
      })
    );
    expect(mockTx.conversationParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: { conversationId: "conv_1", userId: "user_second" },
        },
        update: expect.objectContaining({ role: "ADMIN", status: "ACTIVE" }),
      })
    );
  });

  test("Serializes duplicate active cohort checks per user & blocks joining second cohort for same batch", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_dup" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_dup",
      name: "Dup Tester",
      username: "duptest",
      isActive: true,
      phoneVerified: true,
    });

    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_b",
      cohortCode: "BB-ALLEN-KOTA-BBBB",
      title: "Second Cohort Same Batch",
      instituteId: "inst_allen",
      batchId: "batch_1",
      status: "FORMING",
      formingExpiresAt: new Date(Date.now() + 86400000),
      maxCapacity: 25,
      minRequired: 5,
      targetSize: 10,
      createdById: "user_other",
      conversationId: "conv_b",
      institute: { id: "inst_allen", slug: "allen-kota", name: "Allen" },
      batch: { id: "batch_1", name: "Nurture" },
      members: [{ id: "m1", userId: "user_other", stage: "INTENT_VERIFIED" }],
    });
    mockTx.groupCohortMember.findFirst.mockResolvedValueOnce({
      cohort: { cohortCode: "BB-ALLEN-KOTA-AAAA" },
    });

    const res = await joinBatchBuyCohort({
      cohortId: "cohort_b",
      intent: baseIntent,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already participating in cohort BB-ALLEN-KOTA-AAAA/);
    // Both user lock and cohort lock acquired in consistent order inside Serializable tx
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockTx.groupCohortMember.create).not.toHaveBeenCalled();
  });

  test("Minor guardian details do not fabricate parentNotifiedAt or verified consent", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_minor" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_minor",
      name: "Minor Student",
      username: "minor1",
      isActive: true,
      phoneVerified: true,
    });
    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_1",
      cohortCode: "BB-ALLEN-KOTA-MIN1",
      title: "Minor Safe Cohort",
      instituteId: "inst_allen",
      batchId: "batch_1",
      status: "FORMING",
      formingExpiresAt: new Date(Date.now() + 86400000),
      maxCapacity: 25,
      minRequired: 5,
      targetSize: 10,
      createdById: "user_other",
      conversationId: "conv_1",
      institute: { id: "inst_allen", slug: "allen-kota", name: "Allen" },
      batch: { id: "batch_1", name: "Nurture" },
      members: [{ id: "m1", userId: "user_other", stage: "INTENT_VERIFIED" }],
    });
    mockTx.groupCohortMember.findFirst.mockResolvedValueOnce(null);
    mockTx.message.create.mockResolvedValueOnce({ id: "msg_minor" });
    (prisma.groupAdmissionCohort.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await joinBatchBuyCohort({
      cohortId: "cohort_1",
      intent: {
        ...baseIntent,
        isMinor: true,
        parentName: "Suresh Verma",
        parentPhone: "+91 9876543210",
      },
    });

    expect(res.success).toBe(true);
    expect(mockTx.groupCohortMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isMinor: true,
          parentName: "Suresh Verma",
          parentPhone: "9876543210",
          parentNotifiedAt: null,
          parentConsentVerifiedAt: null,
          parentConsentMethod: null,
        }),
      })
    );
  });

  test("Transitions expired FORMING cohort to EXPIRED and rejects join", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_late" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_late",
      name: "Late User",
      username: "late1",
      isActive: true,
      phoneVerified: true,
    });
    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_exp",
      cohortCode: "BB-ALLEN-KOTA-EXP1",
      title: "Expired Cohort",
      instituteId: "inst_allen",
      batchId: "batch_1",
      status: "FORMING",
      formingExpiresAt: new Date(Date.now() - 3600000),
      maxCapacity: 25,
      minRequired: 5,
      targetSize: 10,
      createdById: "user_other",
      conversationId: "conv_1",
      institute: { id: "inst_allen", slug: "allen-kota", name: "Allen" },
      batch: { id: "batch_1", name: "Nurture" },
      members: [],
    });

    const res = await joinBatchBuyCohort({
      cohortId: "cohort_exp",
      intent: baseIntent,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expired/i);
    expect(mockTx.groupAdmissionCohort.update).toHaveBeenCalledWith({
      where: { id: "cohort_exp" },
      data: { status: "EXPIRED" },
    });
    expect(mockTx.groupCohortMember.create).not.toHaveBeenCalled();
  });

  test("Cancels cohort and sets conversation readOnly when last member leaves", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_only" },
    });
    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce({
      id: "cohort_empty",
      cohortCode: "BB-ALLEN-KOTA-EMP1",
      status: "FORMING",
      targetSize: 10,
      createdById: "user_only",
      conversationId: "conv_empty",
      institute: { id: "inst_allen", slug: "allen" },
      members: [
        {
          id: "m_only",
          userId: "user_only",
          stage: "INTENT_VERIFIED",
          user: { name: "Solo User", username: "solo" },
        },
      ],
    });
    mockTx.message.create.mockResolvedValueOnce({ id: "msg_cancel" });

    const res = await leaveBatchBuyCohort("cohort_empty");
    expect(res.success).toBe(true);
    expect(res.cancelled).toBe(true);
    expect(mockTx.groupAdmissionCohort.update).toHaveBeenCalledWith({
      where: { id: "cohort_empty" },
      data: { status: "CANCELLED" },
    });
    expect(mockTx.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv_empty" },
        data: expect.objectContaining({
          memberCount: 0,
          isReadOnly: true,
        }),
      })
    );
  });

  test("Rolls back cleanly if chat participant insert fails during cohort creation", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_fail" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user_fail",
      name: "Fail User",
      username: "failuser",
      isActive: true,
      phoneVerified: true,
    });
    (prisma.institute.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "inst_allen",
      name: "Allen Career Institute",
      slug: "allen-kota",
      city: { name: "Kota" },
      managers: [],
    });
    (prisma.instituteBatch.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "batch_1",
      name: "Nurture",
    });

    mockTx.groupCohortMember.findFirst.mockResolvedValueOnce(null);
    mockTx.groupAdmissionCohort.findUnique.mockResolvedValueOnce(null);
    mockTx.conversation.create.mockResolvedValueOnce({ id: "conv_fail" });
    mockTx.groupAdmissionCohort.create.mockResolvedValueOnce({
      id: "cohort_fail",
      cohortCode: "BB-ALLEN-KOTA-FAIL",
    });
    mockTx.conversationParticipant.create.mockRejectedValueOnce(new Error("Simulated DB constraint failure"));

    const res = await createBatchBuyCohort({
      instituteId: "inst_allen",
      batchId: "batch_1",
      title: "Rollback Verification Cohort",
      examCategory: "JEE",
      targetAcademicYear: 2027,
      minRequired: 5,
      targetSize: 10,
      maxCapacity: 25,
      formingDays: 14,
      intent: baseIntent,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("Simulated DB constraint failure");
    expect(mockTx.message.create).not.toHaveBeenCalled();
  });

  test("Strips student PII and hides private conversationId from non-members in public DTOs", async () => {
    (prisma.groupAdmissionCohort.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "cohort_1",
      cohortCode: "BB-ALLEN-KOTA-7K3M",
      title: "Allen JEE 2027",
      examCategory: "JEE",
      targetAcademicYear: 2027,
      status: "FORMING",
      targetSize: 10,
      minRequired: 5,
      maxCapacity: 25,
      formingExpiresAt: new Date(Date.now() + 86400000),
      admissionDeadlineAt: null,
      createdAt: new Date(),
      createdById: "user_1",
      conversationId: "conv_1",
      instituteId: "inst_allen",
      batchId: "batch_1",
      institute: {
        id: "inst_allen",
        slug: "allen-kota",
        name: "Allen Career Institute",
        logo: null,
        isVerified: true,
        city: { name: "Kota", slug: "kota" },
      },
      batch: {
        id: "batch_1",
        name: "Nurture Batch A",
        courseName: "JEE",
        fee: 145000,
        originalFee: 160000,
        mode: "OFFLINE",
        academicYear: "2027",
      },
      members: [
        {
          id: "m1",
          userId: "user_1",
          stage: "INTENT_VERIFIED",
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: new Date(),
          isMinor: true,
          joinedAt: new Date(),
          user: {
            id: "user_1",
            name: "Aarav Sharma",
            username: "aarav",
            image: null,
            studentProfile: { city: "Kota" },
          },
        },
      ],
    });

    const dto = await getCohortDetailsByCode("bb-allen-kota-7k3m", null);
    expect(dto).not.toBeNull();
    expect(dto!.conversationId).toBeNull();
    expect(dto!.members[0].displayName).toBe("Aarav S.");
    const serialized = JSON.stringify(dto!.members);
    expect(serialized).not.toContain("parentPhone");
    expect(serialized).not.toContain("parentName");
    expect(serialized).not.toContain("9876543210");
  });
});
