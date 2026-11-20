import { z } from "zod";
import type { SlabFallbackPolicyType } from "./slabValidation";

export const COHORT_EXAM_CATEGORIES = [
  "JEE",
  "NEET",
  "UPSC",
  "CAT",
  "GATE",
  "CLAT",
  "CUET",
  "NDA",
  "Foundation / School",
  "SSC / Banking",
  "Other",
] as const;

export const MIN_COHORT_TARGET_SIZE = 2;
export const MAX_COHORT_TARGET_SIZE = 50;
export const MAX_COHORT_CAPACITY = 100;
export const MIN_FORMING_DAYS = 3;
export const MAX_FORMING_DAYS = 30;

/**
 * Normalizes an Indian mobile number (10 digits starting with 6-9).
 * Returns cleaned 10-digit string or null if invalid.
 */
export function normalizeIndianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return null;
  }
  return digits;
}

/**
 * Masks a phone number for safe display to its owner or authorized views (e.g. ******3210).
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Extracts a privacy-safe first name / display label for public cohort rosters.
 */
export function formatPublicMemberName(name: string | null | undefined, username?: string | null): string {
  const trimmed = (name || "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
  }
  if (username) {
    return `@${username}`;
  }
  return "Aspirant";
}

export const IntentVerificationSchema = z
  .object({
    confirmIntent: z.boolean().refine((v) => v === true, {
      message:
        "Please explicitly confirm that you genuinely intend to enroll in this course if a suitable group offer is issued.",
    }),
    targetExam: z
      .string()
      .trim()
      .min(2, "Please select or enter your target exam.")
      .max(80, "Target exam cannot exceed 80 characters."),
    targetAcademicYear: z
      .number()
      .int("Target academic year must be a whole year.")
      .min(2025, "Academic year must be 2025 or later.")
      .max(2032, "Academic year cannot exceed 2032."),
    currentClass: z
      .string()
      .trim()
      .min(1, "Please specify your current class or academic status.")
      .max(80, "Current class/status cannot exceed 80 characters."),
    isMinor: z.boolean().default(false),
    parentName: z
      .string()
      .trim()
      .max(120, "Parent/guardian name cannot exceed 120 characters.")
      .optional()
      .nullable(),
    parentPhone: z
      .string()
      .trim()
      .max(20, "Parent phone cannot exceed 20 characters.")
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.isMinor) {
      if (!data.parentName || data.parentName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentName"],
          message: "Parent or legal guardian name is required for applicants under 18 (DPDPA 2023).",
        });
      }
      const normalized = normalizeIndianPhone(data.parentPhone);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentPhone"],
          message: "A valid 10-digit Indian parent/guardian mobile number is required for minor applicants.",
        });
      }
    }
  });

export type IntentVerificationInput = z.infer<typeof IntentVerificationSchema>;

export const CreateCohortInputSchema = z
  .object({
    instituteId: z.string().min(1, "Institute is required."),
    batchId: z.string().min(1, "Please select a batch for this cohort."),
    customBatchName: z.string().trim().max(120).optional(),
    title: z
      .string()
      .trim()
      .min(5, "Cohort title must be at least 5 characters.")
      .max(120, "Cohort title cannot exceed 120 characters."),
    examCategory: z
      .string()
      .trim()
      .min(2, "Exam category is required.")
      .max(80, "Exam category cannot exceed 80 characters."),
    targetAcademicYear: z
      .number()
      .int("Target academic year must be a valid year.")
      .min(2025, "Academic year must be 2025 or later.")
      .max(2032, "Academic year cannot exceed 2032."),
    minRequired: z
      .number()
      .int()
      .min(MIN_COHORT_TARGET_SIZE, `Minimum group quorum must be at least ${MIN_COHORT_TARGET_SIZE} students.`)
      .max(MAX_COHORT_TARGET_SIZE, `Minimum quorum cannot exceed ${MAX_COHORT_TARGET_SIZE}.`),
    targetSize: z
      .number()
      .int()
      .min(MIN_COHORT_TARGET_SIZE, `Target size must be at least ${MIN_COHORT_TARGET_SIZE} students.`)
      .max(MAX_COHORT_TARGET_SIZE, `Target size cannot exceed ${MAX_COHORT_TARGET_SIZE} students.`),
    maxCapacity: z
      .number()
      .int()
      .min(MIN_COHORT_TARGET_SIZE)
      .max(MAX_COHORT_CAPACITY, `Maximum capacity cannot exceed ${MAX_COHORT_CAPACITY} students.`)
      .default(25),
    formingDays: z
      .number()
      .int()
      .min(MIN_FORMING_DAYS, `Forming window must be at least ${MIN_FORMING_DAYS} days.`)
      .max(MAX_FORMING_DAYS, `Forming window cannot exceed ${MAX_FORMING_DAYS} days.`)
      .default(14),
    intent: IntentVerificationSchema,
  })
  .superRefine((data, ctx) => {
    if (data.minRequired > data.targetSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minRequired"],
        message: "Minimum quorum cannot be greater than the cohort target size.",
      });
    }
    if (data.targetSize > data.maxCapacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCapacity"],
        message: "Maximum capacity must be greater than or equal to target size.",
      });
    }
  });

export type CreateCohortInput = z.infer<typeof CreateCohortInputSchema>;

export const JoinCohortInputSchema = z.object({
  cohortId: z.string().min(1, "Cohort reference is required."),
  intent: IntentVerificationSchema,
});

export type JoinCohortInput = z.infer<typeof JoinCohortInputSchema>;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Builds a memorable BatchBuy cohort code such as `BB-ALLEN-KOTA-7K3M`.
 */
export function generateCohortCodeCandidate(instituteName: string, cityName?: string | null): string {
  const cleanToken = (raw: string, fallback: string, maxLen: number) => {
    const letters = raw
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^A-Z0-9]/g, "") || fallback;
    return letters.slice(0, maxLen) || fallback;
  };

  const instToken = cleanToken(instituteName, "COACH", 6);
  const cityToken = cleanToken(cityName || "IND", "IND", 4);

  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }

  return `BB-${instToken}-${cityToken}-${suffix}`;
}

export interface WhatsAppShareParams {
  cohortCode: string;
  title: string;
  instituteName: string;
  batchName: string;
  currentCount: number;
  targetSize: number;
  maxDiscountPct?: number | null;
  baseUrl?: string;
}

/**
 * Generates a pre-filled WhatsApp share link (`https://wa.me/?text=...`) for viral student invites.
 */
export function buildWhatsAppShareUrl(params: WhatsAppShareParams): string {
  const origin = (params.baseUrl || "https://academyfind.com").replace(/\/+$/, "");
  const inviteUrl = `${origin}/batchbuy/${encodeURIComponent(params.cohortCode)}`;
  const remaining = Math.max(0, params.targetSize - params.currentCount);

  const discountLine =
    params.maxDiscountPct && params.maxDiscountPct > 0
      ? `Target group savings: up to ${params.maxDiscountPct}% off tuition`
      : "Unlocks collective group admission discounts";

  const spotsLine =
    remaining > 0
      ? `${params.currentCount}/${params.targetSize} students joined (${remaining} spot${remaining === 1 ? "" : "s"} left to hit target!).`
      : `${params.currentCount} students joined! Cohort target reached — join before capacity closes.`;

  const text = [
    `Hey! Join our AcademyFind BatchBuy admission cohort for *${params.instituteName}* (${params.batchName}).`,
    `Cohort: ${params.title} (${params.cohortCode})`,
    discountLine,
    spotsLine,
    `No advance fee on AcademyFind — pay the institute directly upon admission.`,
    `Join here: ${inviteUrl}`,
  ].join("\n");

  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export interface SlabTierForProgress {
  id: string;
  instituteId: string;
  batchId: string | null;
  minStudents: number;
  maxStudents: number | null;
  discountPercentage: number;
  waiveRegistration: boolean;
  includedPerks: string[];
  fallbackPolicy: SlabFallbackPolicyType;
  notes: string | null;
}

export interface CohortSlabProgress {
  currentSlab: SlabTierForProgress | null;
  nextSlab: SlabTierForProgress | null;
  studentsToNextSlab: number;
  maxDiscountPercentage: number;
  fallbackPolicy: SlabFallbackPolicyType | null;
}

/**
 * Pure helper computing which BatchBuy slab is currently unlocked and how many more students
 * are needed for the next higher tier.
 */
export function computeCohortSlabProgress(
  activeMemberCount: number,
  slabs: SlabTierForProgress[]
): CohortSlabProgress {
  if (!slabs || slabs.length === 0) {
    return {
      currentSlab: null,
      nextSlab: null,
      studentsToNextSlab: 0,
      maxDiscountPercentage: 0,
      fallbackPolicy: null,
    };
  }

  const sorted = [...slabs].sort((a, b) => a.minStudents - b.minStudents);

  let currentSlab =
    sorted.find(
      (s) =>
        activeMemberCount >= s.minStudents &&
        (s.maxStudents === null || activeMemberCount <= s.maxStudents)
    ) || null;

  const topSlab = sorted[sorted.length - 1];
  if (!currentSlab && topSlab.maxStudents !== null && activeMemberCount > topSlab.maxStudents) {
    currentSlab = topSlab;
  }

  const nextSlab = sorted.find((s) => s.minStudents > activeMemberCount) || null;
  const studentsToNextSlab = nextSlab ? Math.max(0, nextSlab.minStudents - activeMemberCount) : 0;
  const maxDiscountPercentage = Math.max(...sorted.map((s) => s.discountPercentage), 0);
  const fallbackPolicy =
    currentSlab?.fallbackPolicy || nextSlab?.fallbackPolicy || sorted[0]?.fallbackPolicy || null;

  return {
    currentSlab,
    nextSlab,
    studentsToNextSlab,
    maxDiscountPercentage,
    fallbackPolicy,
  };
}

export interface MemberIntentSignals {
  phoneVerified: boolean;
  profileConfirmed: boolean;
  explicitIntentAt: Date | string | null | undefined;
}

/**
 * Unambiguously separates Level 1 (Phone OTP), Level 2 (Course/Academic Fit),
 * and Level 3 (Explicit Admission Intent).
 * A verified phone number alone NEVER grants `INTENT_VERIFIED` status.
 */
export function resolveMemberIntentState(signals: MemberIntentSignals) {
  const hasPhoneVerification = Boolean(signals.phoneVerified);
  const hasCourseConfirmation = Boolean(signals.profileConfirmed);
  const hasExplicitIntent = Boolean(signals.explicitIntentAt);
  const isFullyIntentVerified =
    hasPhoneVerification && hasCourseConfirmation && hasExplicitIntent;

  return {
    hasPhoneVerification,
    hasCourseConfirmation,
    hasExplicitIntent,
    isFullyIntentVerified,
    stage: (isFullyIntentVerified ? "INTENT_VERIFIED" : "INTERESTED") as
      | "INTENT_VERIFIED"
      | "INTERESTED",
  };
}
