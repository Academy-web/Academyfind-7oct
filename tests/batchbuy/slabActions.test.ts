jest.mock("../../app/generated/prisma/client", () => ({
  Prisma: {
    Decimal: class MockDecimal {
      private val: number;
      constructor(v: string | number) {
        this.val = Number(v);
      }
      toString() {
        return String(this.val);
      }
      valueOf() {
        return this.val;
      }
    },
    TransactionIsolationLevel: {
      Serializable: "Serializable",
    },
    PrismaClientKnownRequestError: class MockPrismaError extends Error {
      code = "";
    },
  },
}));

import {
  saveInstituteDiscountSlabs,
  toggleDiscountSlabStatus,
  archiveDiscountSlab,
} from "../../lib/batchbuy/slabActions";
import { auth } from "../../lib/auth/auth";
import { prisma } from "../../lib/prisma";
import { writeBatchBuyAuditLogTx } from "../../lib/batchbuy/redemptionAuth";

jest.mock("../../lib/batchbuy/redemptionAuth", () => ({
  writeBatchBuyAuditLogTx: jest.fn(async () => ({ id: "audit_slab_1" })),
}));

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

const mockTx = {
  $queryRaw: jest.fn(),
  groupDiscountSlab: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock("../../lib/prisma", () => ({
  prisma: {
    instituteManager: {
      findUnique: jest.fn(),
    },
    instituteMembership: {
      findFirst: jest.fn(),
    },
    instituteBatch: {
      findFirst: jest.fn(),
    },
    groupDiscountSlab: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)),
  },
}));

describe("BatchBuy Slab Actions — Authorization, Persistence, IDOR & Concurrency", () => {
  const instituteId = "inst_allen";
  const managerUserId = "user_mgr_1";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Rejects unauthenticated users", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce(null);

    const res = await saveInstituteDiscountSlabs({
      instituteId,
      slabs: [
        {
          minStudents: 5,
          maxStudents: 9,
          discountPercentage: 8,
          waiveRegistration: true,
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          isActive: true,
        },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Authentication required/);
  });

  test("Rejects non-manager users (e.g., STUDENT or SALES_MANAGER without manager rights)", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: "user_sales_1", role: "INSTITUTE_SALES_MANAGER" },
    });
    (prisma.instituteManager.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.instituteMembership.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const res = await saveInstituteDiscountSlabs({
      instituteId,
      slabs: [
        {
          minStudents: 5,
          maxStudents: 9,
          discountPercentage: 8,
          waiveRegistration: true,
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          isActive: true,
        },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Access denied/);
  });

  test("Rejects IDOR attempt when updating a slab ID belonging to another institute or scope", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: managerUserId, role: "USER" },
    });
    (prisma.instituteManager.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: managerUserId,
      instituteId,
    });
    // Existing slabs in this scope do NOT contain "foreign_slab_999"
    mockTx.groupDiscountSlab.findMany.mockResolvedValueOnce([]);

    const res = await saveInstituteDiscountSlabs({
      instituteId,
      slabs: [
        {
          id: "foreign_slab_999",
          minStudents: 5,
          maxStudents: 9,
          discountPercentage: 8,
          waiveRegistration: true,
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          isActive: true,
        },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid or unauthorized slab reference/);
  });

  test("Saves slabs inside Serializable transaction with row-level lock & archives removed slabs", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: managerUserId, role: "USER" },
    });
    (prisma.instituteManager.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: managerUserId,
      instituteId,
    });

    // Existing DB has 1 slab that is being replaced/removed
    mockTx.groupDiscountSlab.findMany
      .mockResolvedValueOnce([
        {
          id: "old_slab_1",
          instituteId,
          batchId: null,
          minStudents: 5,
          maxStudents: 9,
          discountPercentage: 8.0,
        },
      ])
      // Post-write invariant check query returns newly saved active slab
      .mockResolvedValueOnce([
        {
          id: "new_slab_2",
          minStudents: 6,
          maxStudents: 12,
          discountPercentage: 10.0,
          waiveRegistration: true,
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          notes: null,
          isActive: true,
        },
      ]);

    const res = await saveInstituteDiscountSlabs({
      instituteId,
      slabs: [
        {
          minStudents: 6,
          maxStudents: 12,
          discountPercentage: 10,
          waiveRegistration: true,
          includedPerks: [],
          fallbackPolicy: "ABSORB_SHORTFALL",
          isActive: true,
        },
      ],
    });

    expect(res.success).toBe(true);
    // Verified FOR UPDATE lock executed
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    // Verified old slab soft-archived
    expect(mockTx.groupDiscountSlab.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old_slab_1" },
        data: expect.objectContaining({ isArchived: true, isActive: false }),
      })
    );
    // Verified new slab created
    expect(mockTx.groupDiscountSlab.create).toHaveBeenCalledTimes(1);
    // Verified Serializable isolation option passed to $transaction
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" })
    );
  });

  test("Blocks reactivating a deactivated slab if it overlaps with an existing active slab", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: managerUserId, role: "ADMIN" },
    });

    mockTx.groupDiscountSlab.findFirst.mockResolvedValueOnce({
      id: "deactivated_slab",
      instituteId,
      batchId: null,
      isActive: false,
      isArchived: false,
    });

    // Post-toggle active slabs contain overlap [5-10] and [8-15]
    mockTx.groupDiscountSlab.findMany.mockResolvedValueOnce([
      {
        id: "deactivated_slab",
        minStudents: 5,
        maxStudents: 10,
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
        isActive: true,
      },
      {
        id: "existing_active_slab",
        minStudents: 8,
        maxStudents: 15,
        discountPercentage: 12.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
        isActive: true,
      },
    ]);

    const res = await toggleDiscountSlabStatus(instituteId, "deactivated_slab", true);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Overlapping slab ranges/);
  });

  test("Archive prevents archiving a slab from another institute and audits valid archive", async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: managerUserId, role: "ADMIN" },
    });
    mockTx.groupDiscountSlab.findFirst.mockResolvedValueOnce(null);

    const res = await archiveDiscountSlab(instituteId, "foreign_slab_id");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Slab not found/);
    expect(mockTx.groupDiscountSlab.update).not.toHaveBeenCalled();

    (auth.api.getSession as unknown as jest.Mock).mockResolvedValueOnce({
      user: { id: managerUserId, role: "ADMIN" },
    });
    mockTx.groupDiscountSlab.findFirst.mockResolvedValueOnce({
      id: "slab_own_1",
      instituteId,
      batchId: null,
      isActive: true,
      isArchived: false,
    });
    const okRes = await archiveDiscountSlab(instituteId, "slab_own_1");
    expect(okRes.success).toBe(true);
    expect(writeBatchBuyAuditLogTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        instituteId,
        action: "SLAB_ARCHIVED",
        entityType: "GroupDiscountSlab",
        entityId: "slab_own_1",
      })
    );
  });
});
