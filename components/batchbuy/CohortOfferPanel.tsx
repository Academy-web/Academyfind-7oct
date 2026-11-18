"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  Lock,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { StudentOfferWorkspaceData } from "@/lib/batchbuy/offerQueries";
import {
  requestGuardianConsentOtpAction,
  respondToCohortOfferAction,
  verifyGuardianConsentOtpAction,
} from "@/lib/batchbuy/offerActions";
import { respondToFallbackAdjustmentAction } from "@/lib/batchbuy/redemptionActions";
import { getFallbackPolicyMeta } from "./fallbackPolicyInfo";
import { AdmissionVoucherCard } from "./AdmissionVoucherCard";
import { Button } from "@/components/ui/button";

function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

interface CohortOfferPanelProps {
  cohortId: string;
  instituteName: string;
  isMember: boolean;
  isFullyIntentVerified: boolean;
  phoneVerified: boolean;
  offerWorkspace: StudentOfferWorkspaceData;
}

export function CohortOfferPanel({
  cohortId,
  instituteName,
  isMember,
  isFullyIntentVerified,
  phoneVerified,
  offerWorkspace,
}: CohortOfferPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDeclineBox, setShowDeclineBox] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [guardianOtp, setGuardianOtp] = useState("");
  const [guardianChecked, setGuardianChecked] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [otpRequestedNow, setOtpRequestedNow] = useState(false);

  const { activeOffer, pastOffers, myDecision, myVoucher, guardianConsent } = offerWorkspace;

  if (!activeOffer && pastOffers.length === 0) {
    return null;
  }

  const handleRequestGuardianOtp = () => {
    startTransition(async () => {
      const res = await requestGuardianConsentOtpAction(cohortId);
      if (!res.success) {
        toast.error(res.error || "Unable to send guardian consent OTP.");
        return;
      }
      setOtpRequestedNow(true);
      if (res.devOtpHint) {
        setDevOtpHint(res.devOtpHint);
      }
      toast.success(
        `Verification code sent to guardian mobile ${res.maskedParentPhone || ""}.`
      );
      router.refresh();
    });
  };

  const handleVerifyGuardianOtp = () => {
    startTransition(async () => {
      const res = await verifyGuardianConsentOtpAction({
        cohortId,
        otp: guardianOtp,
        guardianConfirmationAccepted: guardianChecked,
      });
      if (!res.success) {
        toast.error(res.error || "Guardian OTP verification failed.");
        return;
      }
      setDevOtpHint(null);
      toast.success("Guardian consent verified! You may now respond to the offer.");
      router.refresh();
    });
  };

  const handleRespond = (decision: "ACCEPTED" | "DECLINED") => {
    if (!activeOffer) return;
    startTransition(async () => {
      const res = await respondToCohortOfferAction({
        cohortId,
        offerId: activeOffer.id,
        decision,
        declineReason: decision === "DECLINED" ? declineReason : undefined,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to submit your offer decision.");
        return;
      }

      if (decision === "ACCEPTED") {
        toast.success(
          res.voucher?.isRedeemable
            ? `Offer accepted & ACTIVE voucher ${res.voucher.voucherCode} issued!`
            : `Offer accepted! Bound voucher ${res.voucher?.voucherCode || ""} issued.`
        );
      } else {
        toast.success("Offer declined independently. Your choice has been recorded.");
        setShowDeclineBox(false);
      }
      router.refresh();
    });
  };

  const minorNeedsConsent =
    Boolean(guardianConsent?.isMinor) && !guardianConsent?.parentConsentVerifiedAt;
  const acceptancePct = activeOffer
    ? Math.min(
        100,
        Math.round(
          (activeOffer.acceptedCount / Math.max(1, activeOffer.minAcceptanceQuorum)) * 100
        )
      )
    : 0;
  const offerExpired =
    activeOffer?.effectiveStatus === "EXPIRED" ||
    (activeOffer ? new Date(activeOffer.offerExpiresAt) <= new Date() : false);

  const handleRespondFallbackConsent = (acceptFallbackPrice: boolean) => {
    if (!myVoucher) return;
    startTransition(async () => {
      const res = await respondToFallbackAdjustmentAction({
        voucherId: myVoucher.id,
        acceptFallbackPrice,
      });
      if (!res.success) {
        toast.error(res.error || "Unable to record your fallback decision.");
        return;
      }
      toast.success(
        acceptFallbackPrice
          ? "Revised batch fee accepted cleanly."
          : "Penalty-free admission cancellation recorded. Institute refund initiated."
      );
      router.refresh();
    });
  };

  return (
    <section className="space-y-5">
      {/* Bound Individual Admission Voucher Pass (when issued) */}
      {myVoucher && <AdmissionVoucherCard voucher={myVoucher} />}

      {/* Slice 4 Redemption Settlement & Shortfall Consent Flow */}
      {myVoucher && myVoucher.status === "REDEEMED" && (
        <div
          className={`rounded-3xl border p-5 backdrop-blur-md space-y-3 ${
            myVoucher.settlementState === "PENDING_STUDENT_FALLBACK_CONSENT"
              ? "border-amber-400 bg-amber-50/90 shadow-[0_14px_35px_rgba(245,158,11,0.16)]"
              : myVoucher.settlementState === "CANCELLED_ON_SHORTFALL" ||
                myVoucher.admissionStatus === "CANCELLED" ||
                myVoucher.admissionStatus === "REFUNDED"
              ? "border-rose-200 bg-rose-50/70"
              : "border-emerald-200 bg-emerald-50/60"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <span>Admission Settlement Status</span>
            </div>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-extrabold text-slate-800">
              {myVoucher.settlementState || "SETTLED_FULL_DISCOUNT"}
            </span>
          </div>

          {myVoucher.settlementState === "PROVISIONAL_QUORUM_OPEN" && (
            <p className="text-xs text-slate-700 leading-relaxed">
              Your admission is currently recorded at your accepted offer tuition of{" "}
              <strong>{formatINR(myVoucher.netPayableTuition)}</strong>. Final cohort admission
              quorum ({myVoucher.minAdmissionQuorum} enrollments) will be evaluated after the
              voucher validity window closes — no silent price hike can ever occur without your
              explicit consent.
            </p>
          )}

          {(myVoucher.settlementState === "SETTLED_FULL_DISCOUNT" ||
            myVoucher.settlementState === "SETTLED_SHORTFALL_ABSORBED") && (
            <p className="text-xs text-emerald-900 leading-relaxed font-medium">
              Your BatchBuy tuition of{" "}
              <strong>
                {formatINR(myVoucher.settledTuition ?? myVoucher.netPayableTuition)}
              </strong>{" "}
              is finalized with the institute.
            </p>
          )}

          {myVoucher.settlementState === "SETTLED_FALLBACK_ACCEPTED" && (
            <p className="text-xs text-slate-800 leading-relaxed font-medium">
              You explicitly approved the adjusted fallback fee of{" "}
              <strong>
                {formatINR(myVoucher.settledTuition ?? myVoucher.disclosedFallbackFee ?? myVoucher.baseFee)}
              </strong>{" "}
              after the admission quorum fell short.
            </p>
          )}

          {(myVoucher.settlementState === "CANCELLED_ON_SHORTFALL" ||
            myVoucher.admissionStatus === "CANCELLED" ||
            myVoucher.admissionStatus === "REFUNDED") && (
            <div className="text-xs text-rose-900 space-y-1">
              <p className="font-bold">
                Admission cancelled{" "}
                {myVoucher.settlementState === "CANCELLED_ON_SHORTFALL"
                  ? "without penalty (cohort admission quorum shortfall)"
                  : ""}
                .
              </p>
              {myVoucher.directRefundRequiredAmount != null &&
                myVoucher.directRefundRequiredAmount > 0 && (
                  <p>
                    Direct institute refund tracked:{" "}
                    <strong>{formatINR(myVoucher.directRefundRequiredAmount)}</strong> (Status:{" "}
                    <strong>{myVoucher.directRefundStatus || "PENDING_DIRECT_REFUND"}</strong>)
                  </p>
                )}
            </div>
          )}

          {myVoucher.settlementState === "PENDING_STUDENT_FALLBACK_CONSENT" && (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-amber-950 font-medium leading-relaxed">
                The voucher window closed with fewer confirmed enrollments than the{" "}
                <strong>{myVoucher.minAdmissionQuorum}-student admission quorum</strong>. Under
                this offer&apos;s disclosed <strong>{myVoucher.fallbackPolicy}</strong> policy,
                the applicable fallback fee is{" "}
                <strong>
                  {formatINR(myVoucher.disclosedFallbackFee ?? myVoucher.baseFee)}
                </strong>{" "}
                (compared to the offer price of {formatINR(myVoucher.netPayableTuition)}). You
                must choose explicitly:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs tabular-nums">
                <div className="rounded-2xl border border-amber-200 bg-white p-3">
                  <div className="text-slate-500 font-semibold">Original Offer Tuition</div>
                  <div className="text-base font-extrabold text-slate-800 mt-0.5">
                    {formatINR(myVoucher.netPayableTuition)}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-400 bg-white p-3">
                  <div className="text-amber-800 font-semibold">Disclosed Fallback Tuition</div>
                  <div className="text-base font-extrabold text-amber-950 mt-0.5">
                    {formatINR(myVoucher.disclosedFallbackFee ?? myVoucher.baseFee)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleRespondFallbackConsent(true)}
                  className="rounded-full bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer h-10 px-5"
                >
                  {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Accept Revised Price (
                  {formatINR(myVoucher.disclosedFallbackFee ?? myVoucher.baseFee)})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleRespondFallbackConsent(false)}
                  className="rounded-full border-rose-300 bg-white hover:bg-rose-50 text-rose-700 font-bold cursor-pointer h-10 px-5"
                >
                  Decline &amp; Cancel Without Penalty
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Published Versioned Offer Term Sheet */}
      {activeOffer && (
        <div className="rounded-3xl border border-amber-300/80 bg-white/95 backdrop-blur-md p-6 shadow-[0_14px_40px_rgba(251,191,36,0.1)] space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-900">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>Official Group Offer v{activeOffer.version} (Locked Terms)</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
                {activeOffer.title}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Published by <strong>{instituteName}</strong> · Respond independently (no group
                majority vote applies).
              </p>
            </div>

            <span
              className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold border ${
                activeOffer.effectiveStatus === "QUORUM_MET"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : activeOffer.effectiveStatus === "EXPIRED"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              }`}
            >
              {activeOffer.effectiveStatus === "QUORUM_MET"
                ? "Acceptance Quorum Met"
                : activeOffer.effectiveStatus === "EXPIRED"
                ? "Offer Window Closed"
                : "Accepting Individual Decisions"}
            </span>
          </div>

          {/* Fee Transformation Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 tabular-nums">
            <div>
              <div className="text-xs font-semibold text-slate-500">Listed Batch Fee</div>
              <div className="text-lg font-bold text-slate-500 line-through mt-0.5">
                {formatINR(activeOffer.baseFee)}
              </div>
              {activeOffer.registrationFeeOriginal > 0 && (
                <div className="text-[11px] text-slate-500">
                  Reg fee:{" "}
                  <span className={activeOffer.waiveRegistration ? "line-through" : ""}>
                    {formatINR(activeOffer.registrationFeeOriginal)}
                  </span>{" "}
                  {activeOffer.waiveRegistration ? "(Waived)" : ""}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-emerald-700">
                Cohort Net Tuition ({activeOffer.discountPercentage}% OFF)
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-0.5">
                {formatINR(activeOffer.netPayableTuition)}
              </div>
              <div className="text-[11px] font-semibold text-emerald-700">
                Save {formatINR(activeOffer.totalSavings)} per seat
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <div className="text-xs font-semibold text-slate-500">Deadlines</div>
              <div className="text-xs font-bold text-slate-800 mt-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  Respond by{" "}
                  {new Date(activeOffer.offerExpiresAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Voucher valid until{" "}
                {new Date(activeOffer.voucherExpiresAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
            </div>
          </div>

          {/* Separate Dual Quorums Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-extrabold text-emerald-900">
                <span>1. Offer Acceptance Quorum (Voucher Activation)</span>
                <span className="tabular-nums">
                  {activeOffer.acceptedCount} / {activeOffer.minAcceptanceQuorum}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-emerald-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                  style={{ width: `${acceptancePct}%` }}
                />
              </div>
              <p className="text-[11px] text-emerald-800">
                {activeOffer.acceptedCount >= activeOffer.minAcceptanceQuorum
                  ? "Unlocked! Individual vouchers are ACTIVE for center admission."
                  : `${
                      activeOffer.minAcceptanceQuorum - activeOffer.acceptedCount
                    } more individual acceptance(s) needed to activate vouchers.`}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-extrabold text-amber-900">
                <span>2. Center Admission Quorum (Settlement Gate)</span>
                <span className="tabular-nums">0 / {activeOffer.minAdmissionQuorum}</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                Separate from acceptance quorum: requires{" "}
                <strong>{activeOffer.minAdmissionQuorum} verified center enrollments</strong>.{" "}
                Policy:{" "}
                <strong>{getFallbackPolicyMeta(activeOffer.fallbackPolicy).label}</strong>.
              </p>
            </div>
          </div>

          {/* Perks & Direct Payment Terms */}
          {(activeOffer.includedPerks.length > 0 || activeOffer.paymentTerms) && (
            <div className="space-y-2 text-xs text-slate-700">
              {activeOffer.includedPerks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeOffer.includedPerks.map((perk) => (
                    <span
                      key={perk}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold text-emerald-800"
                    >
                      <CheckCircle2 className="w-3 h-3" /> {perk}
                    </span>
                  ))}
                </div>
              )}
              {activeOffer.paymentTerms && (
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-600">
                  <strong className="text-slate-800">Payment Terms:</strong>{" "}
                  {activeOffer.paymentTerms}
                </div>
              )}
            </div>
          )}

          {/* Member Action Gate */}
          {isMember && !myVoucher && (
            <div className="pt-3 border-t border-slate-100 space-y-4">
              {/* Eligibility Check */}
              {(!phoneVerified || !isFullyIntentVerified) && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Intent Revalidation Required Before Acceptance:</strong> Please
                    complete mobile OTP verification and 3-level admission intent confirmation
                    above before accepting this offer.
                  </div>
                </div>
              )}

              {/* Minor Guardian Consent Gate */}
              {minorNeedsConsent && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 space-y-3">
                  <div className="flex items-start gap-2.5 text-xs text-rose-900">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>Verified Guardian Consent Required (Under-18 Applicant):</strong>{" "}
                      Guardian notification alone is insufficient under AcademyFind policy. Your
                      parent/guardian ({guardianConsent?.maskedParentPhone || "registered mobile"})
                      must complete OTP approval before you can accept this commercial offer.
                      {guardianConsent?.parentNotifiedAt && (
                        <span className="block text-[11px] text-rose-700 mt-0.5">
                          Last notified:{" "}
                          {new Date(guardianConsent.parentNotifiedAt).toLocaleTimeString("en-IN")} —
                          awaiting OTP verification.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleRequestGuardianOtp}
                      disabled={isPending || !guardianConsent?.hasParentDetails}
                      className="rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
                    >
                      {isPending ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Smartphone className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {guardianConsent?.parentNotifiedAt || otpRequestedNow
                        ? "Resend Guardian Consent OTP"
                        : "Send Guardian Consent OTP"}
                    </Button>

                    {devOtpHint && (
                      <span className="rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-[11px] font-mono font-bold text-amber-900">
                        Dev Simulated OTP: {devOtpHint}
                      </span>
                    )}
                  </div>

                  {(guardianConsent?.parentNotifiedAt || otpRequestedNow) && (
                    <div className="rounded-xl border border-rose-200 bg-white p-3.5 space-y-2.5">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={guardianOtp}
                            onChange={(e) => setGuardianOtp(e.target.value.replace(/\D/g, ""))}
                            placeholder="Enter 6-digit guardian OTP"
                            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm font-mono font-bold text-slate-900 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                        <Button
                          type="button"
                          onClick={handleVerifyGuardianOtp}
                          disabled={isPending || guardianOtp.length !== 6 || !guardianChecked}
                          className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
                        >
                          Verify Guardian Consent
                        </Button>
                      </div>

                      <label className="flex items-start gap-2 text-[11px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={guardianChecked}
                          onChange={(e) => setGuardianChecked(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                        />
                        <span>
                          Parent/guardian confirms consent for this minor student to review and
                          independently accept this AcademyFind BatchBuy admission offer.
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {guardianConsent?.isMinor && guardianConsent.parentConsentVerifiedAt && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 flex items-center gap-2 text-xs font-bold text-emerald-800">
                  <BadgeCheck className="w-4 h-4 text-emerald-600" />
                  <span>
                    Guardian Consent Verified (
                    {new Date(guardianConsent.parentConsentVerifiedAt).toLocaleDateString(
                      "en-IN",
                      { day: "numeric", month: "short" }
                    )}
                    )
                  </span>
                </div>
              )}

              {/* Previous DECLINED state */}
              {myDecision?.decision === "DECLINED" && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 flex items-center justify-between gap-2">
                  <span>
                    You declined Offer v{activeOffer.version} on{" "}
                    {new Date(myDecision.decidedAt).toLocaleDateString("en-IN")}. You may still
                    reconsider and accept individually before the deadline.
                  </span>
                </div>
              )}

              {/* Accept / Decline Buttons */}
              {!offerExpired && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => handleRespond("ACCEPTED")}
                      disabled={
                        isPending || !phoneVerified || !isFullyIntentVerified || minorNeedsConsent
                      }
                      className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-sm h-11 px-6 shadow-md shadow-amber-500/20 cursor-pointer disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 mr-2" />
                      )}
                      Accept Offer Individually &amp; Issue Voucher
                    </Button>

                    {myDecision?.decision !== "DECLINED" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowDeclineBox(!showDeclineBox)}
                        disabled={isPending}
                        className="rounded-full border-slate-300 text-slate-700 font-bold text-sm h-11 px-5 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4 mr-1.5" />
                        Decline Offer
                      </Button>
                    )}
                  </div>

                  {showDeclineBox && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                      <label className="block text-xs font-bold text-slate-700">
                        Optional reason for declining (helps institute revise future versions)
                      </label>
                      <textarea
                        rows={2}
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="e.g. Looking for a slightly higher fee discount or weekend timing..."
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-amber-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleRespond("DECLINED")}
                          disabled={isPending}
                          className="rounded-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" /> Confirm Individual Decline
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowDeclineBox(false)}
                          className="rounded-full text-xs cursor-pointer"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Past Superseded / Withdrawn Offers Audit Trail */}
      {pastOffers.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 space-y-2">
          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Previous Offer Versions (Immutable Archive)</span>
          </div>
          <div className="space-y-1.5">
            {pastOffers.map((oldOffer) => (
              <div
                key={oldOffer.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2"
              >
                <span className="font-bold text-slate-800">
                  v{oldOffer.version}: {oldOffer.discountPercentage}% OFF (
                  {formatINR(oldOffer.netPayableTuition)})
                </span>
                <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[10px] font-bold text-slate-700">
                  {oldOffer.effectiveStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
