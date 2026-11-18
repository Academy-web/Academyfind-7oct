import { SlabFallbackPolicyType } from "@/lib/batchbuy/slabValidation";

export interface FallbackPolicyMeta {
  code: SlabFallbackPolicyType;
  label: string;
  shortBadge: string;
  studentExplanation: string;
  toneClass: string;
}

export function getFallbackPolicyMeta(
  policy: SlabFallbackPolicyType | null | undefined
): FallbackPolicyMeta {
  switch (policy) {
    case "REVERT_TO_LOWER_SLAB":
      return {
        code: "REVERT_TO_LOWER_SLAB",
        label: "Reverts to Lower Qualified Slab",
        shortBadge: "Reverts to Lower Slab",
        studentExplanation:
          "If fewer students finally enroll at the center than accepted the offer, the group discount adjusts to the lower slab matching actual verified center admissions.",
        toneClass: "border-amber-200 bg-amber-50/90 text-amber-900",
      };
    case "CANCEL_DISCOUNT":
      return {
        code: "CANCEL_DISCOUNT",
        label: "Requires Full Quorum",
        shortBadge: "Full Quorum Required",
        studentExplanation:
          "If final center admissions fall below the minimum slab count, the group discount is cancelled and standard individual institute fees apply.",
        toneClass: "border-rose-200 bg-rose-50/90 text-rose-900",
      };
    case "ABSORB_SHORTFALL":
    default:
      return {
        code: "ABSORB_SHORTFALL",
        label: "Guaranteed Locked Discount (Shortfall Absorbed)",
        shortBadge: "Locked Rate Protected",
        studentExplanation:
          "Once an offer is issued on qualified quorum, if a couple of teammates drop out before counter admission, the institute honors the locked offer discount for enrolled members.",
        toneClass: "border-emerald-200 bg-emerald-50/90 text-emerald-900",
      };
  }
}

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "Fee on Enquiry";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getDaysRemainingLabel(expiresAtIso: string): {
  daysLeft: number;
  expired: boolean;
  label: string;
} {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) {
    return { daysLeft: 0, expired: true, label: "Forming window ended" };
  }
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft === 1) {
    return { daysLeft: 1, expired: false, label: "Ends within 24 hrs" };
  }
  return { daysLeft, expired: false, label: `${daysLeft} days left` };
}
