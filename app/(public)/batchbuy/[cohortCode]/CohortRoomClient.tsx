"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  GraduationCap,
  Info,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PublicCohortDetailDTO } from "@/lib/batchbuy/cohortQueries";
import type { StudentOfferWorkspaceData } from "@/lib/batchbuy/offerQueries";
import {
  leaveBatchBuyCohort,
  syncMyCohortPhoneVerification,
} from "@/lib/batchbuy/cohortActions";
import { CohortOfferPanel } from "@/components/batchbuy/CohortOfferPanel";
import { CohortShareActions } from "@/components/batchbuy/CohortShareActions";
import { JoinCohortModal } from "@/components/batchbuy/JoinCohortModal";
import {
  formatINR,
  getDaysRemainingLabel,
  getFallbackPolicyMeta,
} from "@/components/batchbuy/fallbackPolicyInfo";

export function CohortRoomClient({
  cohort,
  offerWorkspace,
}: {
  cohort: PublicCohortDetailDTO;
  offerWorkspace?: StudentOfferWorkspaceData;
}) {
  const router = useRouter();
  const [joinOpen, setJoinOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [syncingPhone, setSyncingPhone] = useState(false);

  const userState = cohort.currentUserState;
  const isLoggedIn = Boolean(userState?.isLoggedIn);
  const isMember = Boolean(userState?.isMember);
  const isForming = cohort.status === "FORMING";

  const timeInfo = getDaysRemainingLabel(cohort.formingExpiresAt);
  const fillPercent = Math.min(
    100,
    Math.round((cohort.activeMemberCount / Math.max(1, cohort.targetSize)) * 100)
  );
  const spotsToTarget = Math.max(0, cohort.targetSize - cohort.activeMemberCount);
  const spotsLeftCapacity = Math.max(0, cohort.maxCapacity - cohort.activeMemberCount);

  const { currentSlab, nextSlab, studentsToNextSlab, maxDiscountPercentage, fallbackPolicy } =
    cohort.slabProgress;
  const policyMeta = getFallbackPolicyMeta(fallbackPolicy);

  const instituteHref = cohort.institute.slug
    ? `/institute/${cohort.institute.id}-${cohort.institute.slug}`
    : `/institute/${cohort.institute.id}`;

  // Visual 4-Step BatchBuy Lifecycle Stepper
  const steps = [
    {
      key: "FORMING",
      label: "Forming Group",
      sub: `${cohort.activeMemberCount}/${cohort.minRequired} min quorum`,
      done: cohort.activeMemberCount >= cohort.minRequired && cohort.status !== "FORMING",
      active: cohort.status === "FORMING",
    },
    {
      key: "OFFER_PENDING",
      label: "Offer Published",
      sub: offerWorkspace?.activeOffer
        ? `Offer v${offerWorkspace.activeOffer.version} live`
        : "Center offer review",
      done: ["OFFER_ACTIVE", "ADMISSION_OPEN", "COMPLETED"].includes(cohort.status),
      active: cohort.status === "OFFER_PENDING",
    },
    {
      key: "OFFER_ACTIVE",
      label: "Individual Acceptance",
      sub: "Zero deadlock opt-in",
      done: ["ADMISSION_OPEN", "COMPLETED"].includes(cohort.status),
      active: cohort.status === "OFFER_ACTIVE",
    },
    {
      key: "ADMISSION_OPEN",
      label: "Center Admission",
      sub: "Pay institute directly",
      done: cohort.status === "COMPLETED",
      active: cohort.status === "ADMISSION_OPEN",
    },
  ];

  const handleJoinClick = () => {
    if (!isLoggedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/batchbuy/${cohort.cohortCode}`)}`);
      return;
    }
    setJoinOpen(true);
  };

  const handleLeaveCohort = async () => {
    setLeaving(true);
    try {
      const res = await leaveBatchBuyCohort(cohort.id);
      if (!res.success) {
        toast.error(res.error || "Could not leave cohort.");
        return;
      }
      toast.success(res.message || "Left cohort.");
      setLeaveConfirmOpen(false);
      if (res.cancelled) {
        router.push("/batchbuy");
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Failed to leave cohort.");
    } finally {
      setLeaving(false);
    }
  };

  const handleSyncPhone = async () => {
    setSyncingPhone(true);
    try {
      const res = await syncMyCohortPhoneVerification(cohort.id);
      if (!res.success) {
        toast.error(res.error || "Verification sync pending.");
        return;
      }
      toast.success(res.message || "Phone verification synced!");
      router.refresh();
    } catch {
      toast.error("Could not sync phone verification.");
    } finally {
      setSyncingPhone(false);
    }
  };

  const listedFee = cohort.batch.fee;
  const activeDiscountPct = currentSlab?.discountPercentage || 0;
  const estimatedDiscountedFee =
    listedFee && activeDiscountPct > 0
      ? Math.round(listedFee * (1 - activeDiscountPct / 100))
      : null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 py-6 sm:py-10 space-y-8">
      {/* Top Breadcrumb Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/batchbuy"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-amber-50 hover:border-amber-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to All Cohorts
        </Link>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-mono text-xs font-bold text-amber-800">
            {cohort.cohortCode}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              cohort.status === "FORMING"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-700 border border-slate-200"
            }`}
          >
            {cohort.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Cohort Header Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-amber-200/80 bg-white/90 backdrop-blur-md p-6 sm:p-8 shadow-[0_14px_45px_rgba(251,191,36,0.08)]">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 shrink-0 rounded-2xl border border-amber-200 bg-amber-50/70 overflow-hidden flex items-center justify-center">
              {cohort.institute.logo ? (
                <Image
                  src={cohort.institute.logo}
                  alt={cohort.institute.name}
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Users className="w-7 h-7 text-amber-600" />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-3 py-1 text-amber-900">
                  <GraduationCap className="w-3.5 h-3.5 text-amber-700" />
                  {cohort.examCategory} &bull; {cohort.targetAcademicYear}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {cohort.institute.cityName}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {timeInfo.label}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {cohort.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                <Link
                  href={instituteHref}
                  className="font-bold text-slate-900 hover:text-amber-700 inline-flex items-center gap-1 transition-colors"
                >
                  <span>{cohort.institute.name}</span>
                  {cohort.institute.verified && (
                    <BadgeCheck className="w-4 h-4 text-emerald-600" />
                  )}
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </Link>
                <span className="text-slate-300">&bull;</span>
                <span>
                  Batch: <strong className="text-slate-800">{cohort.batch.name}</strong> (
                  {cohort.batch.mode})
                </span>
              </div>
            </div>
          </div>

          {/* Fee Snapshot */}
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 px-5 py-4 shrink-0 min-w-[230px]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
              {estimatedDiscountedFee ? "Estimated Group Fee" : "Standard Batch Fee"}
            </div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                {estimatedDiscountedFee
                  ? formatINR(estimatedDiscountedFee)
                  : formatINR(listedFee)}
              </span>
              {estimatedDiscountedFee && listedFee && (
                <span className="text-sm font-semibold text-slate-400 line-through">
                  {formatINR(listedFee)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              {currentSlab
                ? `Includes ${currentSlab.discountPercentage}% unlocked slab${
                    currentSlab.waiveRegistration ? " + Reg. Waiver" : ""
                  }`
                : maxDiscountPercentage > 0
                ? `Unlocks up to ${maxDiscountPercentage}% off on quorum`
                : "Indicative fee prior to institute group offer"}
            </p>
          </div>
        </div>

        {/* Visual 4-Step Stepper */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 pt-6 border-t border-slate-100">
          {steps.map((step, idx) => (
            <div
              key={step.key}
              className={`rounded-2xl border p-3.5 transition-all ${
                step.active
                  ? "border-amber-400 bg-amber-50/70 shadow-xs"
                  : step.done
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-slate-200/70 bg-slate-50/60 opacity-75"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-extrabold">
                <span
                  className={
                    step.active
                      ? "text-amber-800"
                      : step.done
                      ? "text-emerald-700"
                      : "text-slate-500"
                  }
                >
                  Step {idx + 1}
                </span>
                {step.active && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                )}
                {step.done && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">{step.label}</div>
              <div className="text-[11px] text-slate-600 mt-0.5">{step.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Split Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Slab Ladder, Policy Disclosure & Privacy-Safe Roster */}
        <div className="lg:col-span-8 space-y-6">
          {/* Phone Verification Upgrade Notice for Logged-in Members Pending OTP */}
          {isMember && userState && !userState.memberPhoneVerified && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Smartphone className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-xs sm:text-sm text-amber-950 space-y-1">
                  <div className="font-extrabold">
                    Upgrade Your Spot to Intent-Verified (Level 1 Mobile OTP)
                  </div>
                  <p className="text-amber-800 leading-relaxed">
                    {userState.accountPhoneVerified
                      ? "Your account phone is verified! Click sync to upgrade your cohort badge."
                      : "Verify your mobile number via OTP in Profile Settings so you qualify when offers & admission vouchers go live."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 shrink-0">
                {userState.accountPhoneVerified ? (
                  <Button
                    onClick={handleSyncPhone}
                    disabled={syncingPhone}
                    className="rounded-full bg-amber-600 hover:bg-amber-700 text-white font-bold h-10 px-4 text-xs"
                  >
                    {syncingPhone ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Sync Verified Status
                  </Button>
                ) : (
                  <Button
                    asChild
                    className="rounded-full bg-amber-600 hover:bg-amber-700 text-white font-bold h-10 px-4 text-xs"
                  >
                    <Link href="/settings/profile">Verify Mobile in Settings</Link>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Slice 3: Official Cohort Offer, Guardian Consent Gate & Individual Admission Voucher */}
          {offerWorkspace && (
            <CohortOfferPanel
              cohortId={cohort.id}
              instituteName={cohort.institute.name}
              isMember={isMember}
              isFullyIntentVerified={Boolean(
                offerWorkspace.eligibilitySummary?.isFullyIntentVerified
              )}
              phoneVerified={Boolean(
                offerWorkspace.eligibilitySummary?.phoneVerified ??
                  userState?.accountPhoneVerified
              )}
              offerWorkspace={offerWorkspace}
            />
          )}

          {/* Discount Slab Tier Ladder */}
          <section className="rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-amber-600" />
                  <span>Institute Discount Slab Ladder</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  {cohort.slabResolution.scope === "BATCH_OVERRIDE"
                    ? "Batch-specific discount tiers published by the institute."
                    : cohort.slabResolution.scope === "INSTITUTE_DEFAULT"
                    ? "Institute-wide BatchBuy discount tiers applicable to this batch."
                    : "Demand-triggered cohort: institute has not pre-published slabs yet."}
                </p>
              </div>
              {nextSlab && studentsToNextSlab > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-extrabold text-amber-800">
                  +{studentsToNextSlab} more for {nextSlab.discountPercentage}% OFF
                </span>
              )}
            </div>

            {cohort.slabResolution.slabs.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cohort.slabResolution.slabs.map((slab) => {
                  const isUnlocked = currentSlab?.id === slab.id;
                  const isPassed = cohort.activeMemberCount > (slab.maxStudents ?? Infinity);
                  return (
                    <div
                      key={slab.id}
                      className={`rounded-2xl border p-4 transition-all ${
                        isUnlocked
                          ? "border-emerald-400 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-300/60"
                          : isPassed
                          ? "border-emerald-200 bg-emerald-50/30 opacity-85"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          {slab.minStudents}
                          {slab.maxStudents ? `–${slab.maxStudents}` : "+"} Students
                        </span>
                        {isUnlocked ? (
                          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                            ACTIVE TIER
                          </span>
                        ) : isPassed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : null}
                      </div>

                      <div className="mt-2 text-2xl font-extrabold text-slate-900">
                        {slab.discountPercentage}% OFF
                      </div>

                      {listedFee && (
                        <div className="text-xs font-semibold text-emerald-700 mt-0.5">
                          Est. {formatINR(Math.round(listedFee * (1 - slab.discountPercentage / 100)))}
                        </div>
                      )}

                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        {slab.waiveRegistration && (
                          <div className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Registration Fee Waived
                          </div>
                        )}
                        {slab.includedPerks.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {slab.includedPerks.map((perk) => (
                              <span
                                key={perk}
                                className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                              >
                                {perk}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-5 flex items-start gap-3 text-sm text-slate-700">
                <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Demand-Triggered Cohort:</strong> Once at least{" "}
                  <strong>{cohort.minRequired} verified students</strong> join this group,
                  AcademyFind notifies {cohort.institute.name} to submit an official custom group
                  fee offer tailored to your cohort.
                </p>
              </div>
            )}

            {/* Explicit Fallback Policy Disclosure Box */}
            {fallbackPolicy && (
              <div className={`rounded-2xl border p-4 text-xs sm:text-sm ${policyMeta.toneClass}`}>
                <div className="font-extrabold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Transparent Shortfall &amp; Fallback Policy: {policyMeta.label}</span>
                </div>
                <p className="mt-1.5 leading-relaxed opacity-95">{policyMeta.studentExplanation}</p>
              </div>
            )}
          </section>

          {/* Privacy-Safe Cohort Member Roster */}
          <section className="rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-600" />
                  <span>Cohort Aspirants ({cohort.activeMemberCount})</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Privacy protected: mobile numbers, emails, and guardian details are never shared
                  publicly.
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-700">
                {cohort.verifiedMemberCount} Full 3-Level Intent-Verified
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {cohort.members.map((member) => (
                <div
                  key={member.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-800 font-bold text-sm flex items-center justify-center overflow-hidden border border-amber-200 shrink-0">
                      {member.image ? (
                        <Image
                          src={member.image}
                          alt={member.displayName}
                          width={40}
                          height={40}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        member.displayName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900">
                          {member.displayName}
                        </span>
                        {member.isCreator && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                            <Crown className="w-3 h-3" /> Founder
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {member.city ? `${member.city} · ` : ""}
                        Joined{" "}
                        {new Date(member.joinedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </div>
                    </div>
                  </div>

                  {/* 3-Level Intent Signals */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold border ${
                        member.phoneVerified
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-50 text-slate-500 border-slate-200"
                      }`}
                    >
                      <Smartphone className="w-3 h-3" />
                      {member.phoneVerified ? "Phone OTP" : "OTP Pending"}
                    </span>
                    {member.profileConfirmed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 font-semibold">
                        <UserCheck className="w-3 h-3" /> Course Fit
                      </span>
                    )}
                    {member.hasExplicitIntent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 font-semibold">
                        <ShieldCheck className="w-3 h-3" /> Intent Confirmed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Sticky Action Rail */}
        <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
          <div className="rounded-3xl border border-amber-200/90 bg-white/95 backdrop-blur-md p-6 shadow-[0_14px_40px_rgba(251,191,36,0.12)] space-y-5">
            {/* Progress Readout */}
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-3xl font-extrabold text-slate-900">
                    {cohort.activeMemberCount}
                  </span>
                  <span className="text-sm font-semibold text-slate-500">
                    {" "}
                    / {cohort.targetSize} target
                  </span>
                </div>
                <span className="text-xs font-extrabold text-amber-700">
                  {fillPercent}% filled
                </span>
              </div>

              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                  style={{ width: `${Math.max(8, fillPercent)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Min Quorum: {cohort.minRequired}</span>
                <span>Max Cap: {cohort.maxCapacity}</span>
              </div>
            </div>

            {/* Primary CTA */}
            {!isMember ? (
              isForming && !timeInfo.expired && spotsLeftCapacity > 0 ? (
                <Button
                  type="button"
                  onClick={handleJoinClick}
                  className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-sm h-12 shadow-md shadow-amber-500/25 hover:shadow-lg transition-all cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {isLoggedIn ? "Join This Cohort (₹0 Advance)" : "Sign In to Join Cohort"}
                </Button>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-center text-xs font-semibold text-slate-600">
                  {cohort.status === "CANCELLED"
                    ? "This cohort was cancelled because all members withdrew."
                    : cohort.status === "EXPIRED" || timeInfo.expired
                    ? "This cohort's forming window has expired."
                    : spotsLeftCapacity <= 0
                    ? "Cohort has reached maximum capacity."
                    : "Cohort is no longer accepting new forming members."}
                </div>
              )
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5 flex items-center gap-2.5 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div>You are a verified member of this cohort</div>
                    <div className="text-[11px] font-medium text-emerald-700 mt-0.5">
                      Stage: {userState?.stage?.replace(/_/g, " ")}
                    </div>
                  </div>
                </div>

                {cohort.conversationId && (
                  <Button
                    asChild
                    className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold h-11"
                  >
                    <Link href={`/chat/${cohort.conversationId}`}>
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Open Cohort Study Chat
                    </Link>
                  </Button>
                )}
              </div>
            )}

            {/* WhatsApp Viral Sharing & Copy Invite Link */}
            <div className="pt-4 border-t border-slate-100 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Invite Aspirants to Unlock Higher Slabs
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {spotsToTarget > 0
                  ? `Share with coaching classmates or Telegram/WhatsApp prep groups — just ${spotsToTarget} more needed for target!`
                  : "Share your cohort link to fill remaining spots up to group capacity."}
              </p>
              <CohortShareActions
                cohortCode={cohort.cohortCode}
                title={cohort.title}
                instituteName={cohort.institute.name}
                batchName={cohort.batch.name}
                currentCount={cohort.activeMemberCount}
                targetSize={cohort.targetSize}
                maxDiscountPct={maxDiscountPercentage}
                conversationId={null}
                isMember={false}
              />
            </div>

            {/* Leave Cohort Option */}
            {isMember && isForming && (
              <div className="pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setLeaveConfirmOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Leave Cohort
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Join Modal */}
      <JoinCohortModal
        open={joinOpen}
        onOpenChange={setJoinOpen}
        cohort={{
          id: cohort.id,
          cohortCode: cohort.cohortCode,
          title: cohort.title,
          examCategory: cohort.examCategory,
          targetAcademicYear: cohort.targetAcademicYear,
          instituteName: cohort.institute.name,
          batchName: cohort.batch.name,
        }}
        fallbackPolicy={fallbackPolicy}
        accountPhoneVerified={Boolean(userState?.accountPhoneVerified)}
        profilePrefill={userState?.profilePrefill}
      />

      {/* Leave Confirmation Dialog */}
      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave BatchBuy Cohort?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be removed from {cohort.cohortCode} and its group study chat.
              {userState?.isCreator &&
                cohort.activeMemberCount > 1 &&
                " Since you founded this cohort, leadership will automatically pass to the next earliest member."}
              {cohort.activeMemberCount <= 1 &&
                " As the only remaining member, leaving will cancel this cohort."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Stay in Cohort</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveCohort}
              disabled={leaving}
              className="rounded-full bg-rose-600 hover:bg-rose-700 text-white"
            >
              {leaving ? "Leaving..." : "Yes, Leave Cohort"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
