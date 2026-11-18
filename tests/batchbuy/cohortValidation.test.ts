import {
  buildWhatsAppShareUrl,
  computeCohortSlabProgress,
  CreateCohortInputSchema,
  formatPublicMemberName,
  generateCohortCodeCandidate,
  IntentVerificationSchema,
  maskPhone,
  normalizeIndianPhone,
  resolveMemberIntentState,
} from "../../lib/batchbuy/cohortValidation";
import type { EffectiveDiscountSlab } from "../../lib/batchbuy/slabResolver";

describe("BatchBuy Cohort Validation & Helpers", () => {
  test("Normalizes Indian mobile numbers and rejects invalid ones", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("9876543210");
    expect(normalizeIndianPhone("+91 98765-43210")).toBe("9876543210");
    expect(normalizeIndianPhone("09876543210")).toBe("9876543210");
    expect(normalizeIndianPhone("1234567890")).toBeNull(); // Must start with 6-9
    expect(normalizeIndianPhone("98765")).toBeNull();
  });

  test("Masks phone numbers and formats privacy-safe public display names", () => {
    expect(maskPhone("9876543210")).toBe("******3210");
    expect(formatPublicMemberName("Aarav Sharma", "aarav_s")).toBe("Aarav S.");
    expect(formatPublicMemberName("Priya", "priya99")).toBe("Priya");
    expect(formatPublicMemberName(null, "aspirant2026")).toBe("@aspirant2026");
  });

  test("Enforces explicit intent confirmation and minor DPDPA parental details", () => {
    const missingIntent = IntentVerificationSchema.safeParse({
      confirmIntent: false,
      targetExam: "JEE",
      targetAcademicYear: 2027,
      currentClass: "Class 11",
      isMinor: false,
    });
    expect(missingIntent.success).toBe(false);

    const minorMissingParent = IntentVerificationSchema.safeParse({
      confirmIntent: true,
      targetExam: "JEE",
      targetAcademicYear: 2027,
      currentClass: "Class 11",
      isMinor: true,
      parentName: "",
      parentPhone: "12345",
    });
    expect(minorMissingParent.success).toBe(false);
    if (!minorMissingParent.success) {
      const paths = minorMissingParent.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("parentName");
      expect(paths).toContain("parentPhone");
    }

    const validMinor = IntentVerificationSchema.safeParse({
      confirmIntent: true,
      targetExam: "JEE",
      targetAcademicYear: 2027,
      currentClass: "Class 11",
      isMinor: true,
      parentName: "Rajesh Sharma",
      parentPhone: "+91 9876543210",
    });
    expect(validMinor.success).toBe(true);
  });

  test("Validates cohort bounds (minRequired <= targetSize <= maxCapacity)", () => {
    const invalidOrder = CreateCohortInputSchema.safeParse({
      instituteId: "inst_1",
      batchId: "batch_1",
      title: "Allen JEE Nurture 2027",
      examCategory: "JEE",
      targetAcademicYear: 2027,
      minRequired: 15,
      targetSize: 10,
      maxCapacity: 25,
      formingDays: 14,
      intent: {
        confirmIntent: true,
        targetExam: "JEE",
        targetAcademicYear: 2027,
        currentClass: "Class 11",
        isMinor: false,
      },
    });
    expect(invalidOrder.success).toBe(false);
  });

  test("Generates readable cohort codes and WhatsApp share URLs", () => {
    const code = generateCohortCodeCandidate("Allen Career Institute", "Kota");
    expect(code).toMatch(/^BB-ALLEN-KOTA-[A-Z0-9]{4}$/);

    const waUrl = buildWhatsAppShareUrl({
      cohortCode: code,
      title: "JEE Nurture 2027",
      instituteName: "Allen Career Institute",
      batchName: "Nurture Batch A",
      currentCount: 4,
      targetSize: 10,
      maxDiscountPct: 12,
      baseUrl: "https://academyfind.com",
    });
    expect(waUrl.startsWith("https://wa.me/?text=")).toBe(true);
    const decoded = decodeURIComponent(waUrl.split("text=")[1]);
    expect(decoded).toContain(code);
    expect(decoded).toContain("up to 12% off tuition");
    expect(decoded).toContain("https://academyfind.com/batchbuy/");
  });

  test("Computes unlocked and next slab progression accurately", () => {
    const slabs: EffectiveDiscountSlab[] = [
      {
        id: "s1",
        instituteId: "inst_1",
        batchId: null,
        minStudents: 5,
        maxStudents: 9,
        discountPercentage: 8,
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
      },
      {
        id: "s2",
        instituteId: "inst_1",
        batchId: null,
        minStudents: 10,
        maxStudents: null,
        discountPercentage: 14,
        waiveRegistration: true,
        includedPerks: ["Test Series"],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: null,
      },
    ];

    const early = computeCohortSlabProgress(3, slabs);
    expect(early.currentSlab).toBeNull();
    expect(early.nextSlab?.id).toBe("s1");
    expect(early.studentsToNextSlab).toBe(2);

    const mid = computeCohortSlabProgress(6, slabs);
    expect(mid.currentSlab?.id).toBe("s1");
    expect(mid.nextSlab?.id).toBe("s2");
    expect(mid.studentsToNextSlab).toBe(4);
    expect(mid.fallbackPolicy).toBe("ABSORB_SHORTFALL");

    const top = computeCohortSlabProgress(12, slabs);
    expect(top.currentSlab?.id).toBe("s2");
    expect(top.nextSlab).toBeNull();
    expect(top.studentsToNextSlab).toBe(0);
  });

  test("Separates Phone Verification from Explicit Admission Intent", () => {
    // Verified phone alone NEVER satisfies full intent verification
    const phoneOnly = resolveMemberIntentState({
      phoneVerified: true,
      profileConfirmed: true,
      explicitIntentAt: null,
    });
    expect(phoneOnly.hasPhoneVerification).toBe(true);
    expect(phoneOnly.hasExplicitIntent).toBe(false);
    expect(phoneOnly.isFullyIntentVerified).toBe(false);
    expect(phoneOnly.stage).toBe("INTERESTED");

    // Explicit intent confirmed, phone OTP still pending -> INTERESTED (not INTENT_VERIFIED)
    const intentWithoutOtp = resolveMemberIntentState({
      phoneVerified: false,
      profileConfirmed: true,
      explicitIntentAt: new Date(),
    });
    expect(intentWithoutOtp.hasExplicitIntent).toBe(true);
    expect(intentWithoutOtp.isFullyIntentVerified).toBe(false);
    expect(intentWithoutOtp.stage).toBe("INTERESTED");

    // All 3 independent signals complete -> INTENT_VERIFIED
    const allThree = resolveMemberIntentState({
      phoneVerified: true,
      profileConfirmed: true,
      explicitIntentAt: new Date(),
    });
    expect(allThree.isFullyIntentVerified).toBe(true);
    expect(allThree.stage).toBe("INTENT_VERIFIED");
  });
});
