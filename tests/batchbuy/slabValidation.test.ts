import {
  validateSlabRangesAndTiers,
  SingleSlabInput,
} from "../../lib/batchbuy/slabValidation";

describe("BatchBuy Slab Range & Tier Validation", () => {
  test("Valid sequential slabs pass validation cleanly", () => {
    const validSlabs: SingleSlabInput[] = [
      {
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: ["Free Test Series"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 10,
        maxStudents: 19,
        discountPercentage: 12.0,
        waiveRegistration: true,
        includedPerks: ["Free Test Series", "Study Module Pack"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 20,
        maxStudents: null,
        discountPercentage: 16.0,
        waiveRegistration: true,
        includedPerks: ["Free Test Series", "Study Module Pack", "Hostel Concession"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(validSlabs)).not.toThrow();
  });

  test("Rejects overlapping slab ranges (e.g., 5–10 and 8–15)", () => {
    const overlappingSlabs: SingleSlabInput[] = [
      {
        minStudents: 5,
        maxStudents: 10,
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 8,
        maxStudents: 15,
        discountPercentage: 12.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(overlappingSlabs)).toThrow(
      /Overlapping slab ranges/
    );
  });

  test("Rejects contradictory discounts where higher volume gets lower discount", () => {
    const contradictorySlabs: SingleSlabInput[] = [
      {
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 15.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 10,
        maxStudents: 19,
        discountPercentage: 10.0, // Error: 10% < 15% for larger group!
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(contradictorySlabs)).toThrow(
      /Contradictory discount/
    );
  });

  test("Rejects open-ended slab (maxStudents = null) if it is not the highest tier", () => {
    const misplacedOpenEnded: SingleSlabInput[] = [
      {
        minStudents: 5,
        maxStudents: null, // open-ended in the middle!
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 10,
        maxStudents: 20,
        discountPercentage: 12.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(misplacedOpenEnded)).toThrow(
      /Only the highest volume slab/
    );
  });

  test("Rejects invalid individual slab where maxStudents < minStudents", () => {
    const invertedRange: SingleSlabInput[] = [
      {
        minStudents: 10,
        maxStudents: 5, // invalid
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(invertedRange)).toThrow(
      /Invalid slab range: Maximum students/
    );
  });

  test("Rejects duplicate minimum student numbers", () => {
    const duplicateMin: SingleSlabInput[] = [
      {
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 8.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
      {
        minStudents: 5, // duplicate 5
        maxStudents: 12,
        discountPercentage: 10.0,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        isActive: true,
      },
    ];

    expect(() => validateSlabRangesAndTiers(duplicateMin)).toThrow(
      /Duplicate minimum tier/
    );
  });
});
