import { resolveEffectiveDiscountSlabs } from "../../lib/batchbuy/slabResolver";
import { prisma } from "../../lib/prisma";

jest.mock("../../lib/prisma", () => ({
  prisma: {
    groupDiscountSlab: {
      findMany: jest.fn(),
    },
  },
}));

describe("BatchBuy Slab Precedence & Resolution Engine", () => {
  const instituteId = "inst_allen_kota";
  const batchId = "batch_jee_dropper_2027";

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("Returns batch-specific override slabs when active override slabs exist", async () => {
    (prisma.groupDiscountSlab.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "slab_batch_1",
        instituteId,
        batchId,
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 10.0,
        waiveRegistration: true,
        includedPerks: ["Batch Specific Test Series"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: "Override for dropper batch",
      },
    ]);

    const result = await resolveEffectiveDiscountSlabs(instituteId, batchId);

    expect(result.scope).toBe("BATCH_OVERRIDE");
    expect(result.slabs).toHaveLength(1);
    expect(result.slabs[0].id).toBe("slab_batch_1");
    expect(result.slabs[0].discountPercentage).toBe(10.0);
    // Verified that it called findMany with batchId and didn't fall through to institute defaults
    expect(prisma.groupDiscountSlab.findMany).toHaveBeenCalledTimes(1);
  });

  test("Falls back to institute-wide default slabs when no batch-specific slabs exist for requested batch", async () => {
    // 1st call for batch-specific slabs returns empty array
    (prisma.groupDiscountSlab.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      // 2nd call for institute-wide defaults (batchId: null) returns default slabs
      .mockResolvedValueOnce([
        {
          id: "slab_inst_default_1",
          instituteId,
          batchId: null,
          minStudents: 5,
          maxStudents: 9,
          discountPercentage: 8.0,
          waiveRegistration: true,
          includedPerks: ["Institute Baseline Perks"],
          fallbackPolicy: "ABSORB_SHORTFALL",
          notes: "Institute baseline",
        },
      ]);

    const result = await resolveEffectiveDiscountSlabs(instituteId, batchId);

    expect(result.scope).toBe("INSTITUTE_DEFAULT");
    expect(result.slabs).toHaveLength(1);
    expect(result.slabs[0].id).toBe("slab_inst_default_1");
    expect(result.slabs[0].discountPercentage).toBe(8.0);
    expect(prisma.groupDiscountSlab.findMany).toHaveBeenCalledTimes(2);
  });

  test("Directly resolves institute defaults when batchId is omitted / null", async () => {
    (prisma.groupDiscountSlab.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "slab_inst_default_1",
        instituteId,
        batchId: null,
        minStudents: 5,
        maxStudents: null,
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
      },
    ]);

    const result = await resolveEffectiveDiscountSlabs(instituteId, null);

    expect(result.scope).toBe("INSTITUTE_DEFAULT");
    expect(result.slabs).toHaveLength(1);
    expect(result.slabs[0].batchId).toBeNull();
    expect(prisma.groupDiscountSlab.findMany).toHaveBeenCalledTimes(1);
  });

  test("Returns scope NONE with empty slabs when neither batch override nor institute defaults exist", async () => {
    (prisma.groupDiscountSlab.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // No batch overrides
      .mockResolvedValueOnce([]); // No institute defaults

    const result = await resolveEffectiveDiscountSlabs(instituteId, batchId);

    expect(result.scope).toBe("NONE");
    expect(result.slabs).toEqual([]);
  });
});
