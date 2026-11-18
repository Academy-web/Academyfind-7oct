"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinBatchBuyCohort } from "@/lib/batchbuy/cohortActions";
import { COHORT_EXAM_CATEGORIES } from "@/lib/batchbuy/cohortValidation";
import { SlabFallbackPolicyType } from "@/lib/batchbuy/slabValidation";
import { getFallbackPolicyMeta } from "./fallbackPolicyInfo";

interface JoinCohortModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cohort: {
    id: string;
    cohortCode: string;
    title: string;
    examCategory: string;
    targetAcademicYear: number;
    instituteName: string;
    batchName: string;
  };
  fallbackPolicy: SlabFallbackPolicyType | null;
  accountPhoneVerified: boolean;
  profilePrefill?: {
    targetExam?: string | null;
    targetYear?: number | null;
    currentClass?: string | null;
  };
  onJoined?: () => void;
}

export function JoinCohortModal({
  open,
  onOpenChange,
  cohort,
  fallbackPolicy,
  accountPhoneVerified,
  profilePrefill,
  onJoined,
}: JoinCohortModalProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [targetExam, setTargetExam] = useState(
    profilePrefill?.targetExam || cohort.examCategory || "JEE"
  );
  const [targetAcademicYear, setTargetAcademicYear] = useState(
    profilePrefill?.targetYear || cohort.targetAcademicYear || new Date().getFullYear()
  );
  const [currentClass, setCurrentClass] = useState(
    profilePrefill?.currentClass || "Class 12"
  );
  const [confirmIntent, setConfirmIntent] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");

  const policyMeta = getFallbackPolicyMeta(fallbackPolicy);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await joinBatchBuyCohort({
        cohortId: cohort.id,
        intent: {
          confirmIntent,
          targetExam,
          targetAcademicYear: Number(targetAcademicYear),
          currentClass,
          isMinor,
          parentName: isMinor ? parentName : undefined,
          parentPhone: isMinor ? parentPhone : undefined,
        },
      });

      if (!res.success) {
        if ("requiresAuth" in res && res.requiresAuth) {
          toast.error("Please log in first to join this cohort.");
          router.push(`/login?callbackUrl=${encodeURIComponent(`/batchbuy/${cohort.cohortCode}`)}`);
          return;
        }
        toast.error(res.error || "Could not join cohort.");
        return;
      }

      toast.success(res.message || "Joined BatchBuy cohort!");
      onOpenChange(false);
      onJoined?.();
      router.refresh();
    } catch {
      toast.error("Unexpected error while joining cohort.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border-amber-200/80 bg-white p-6">
        <DialogHeader className="space-y-1.5">
          <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            <Users className="w-3.5 h-3.5 text-amber-600" />
            <span>{cohort.cohortCode}</span>
          </div>
          <DialogTitle className="text-xl font-extrabold text-slate-900">
            Join {cohort.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {cohort.instituteName} &middot; {cohort.batchName}. Zero platform booking fee — you pay
            tuition directly at the institute counter.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Level 1: Phone Verification Status */}
          <div
            className={`rounded-2xl border p-3.5 flex items-start gap-3 ${
              accountPhoneVerified
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                : "border-amber-200 bg-amber-50/70 text-amber-900"
            }`}
          >
            <Smartphone className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="flex-1 text-xs leading-relaxed">
              <div className="font-bold flex items-center gap-1.5">
                <span>Level 1 · Mobile Verification</span>
                {accountPhoneVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    <CheckCircle2 className="w-3 h-3" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    Pending OTP
                  </span>
                )}
              </div>
              {accountPhoneVerified ? (
                <p className="mt-1 text-emerald-800">
                  Your mobile OTP is verified. Submitting this form gives you full{" "}
                  <strong>Intent-Verified</strong> cohort status.
                </p>
              ) : (
                <p className="mt-1 text-amber-800">
                  You can join now as an interested member, and{" "}
                  <Link
                    href="/settings/profile"
                    className="underline font-bold hover:text-amber-950"
                  >
                    verify your mobile via OTP in Profile Settings
                  </Link>{" "}
                  before group offers are finalized.
                </p>
              )}
            </div>
          </div>

          {/* Level 2: Academic & Course Intent Confirmation */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <UserCheck className="w-4 h-4 text-amber-600" />
              <span>Level 2 · Confirm Course & Academic Details</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="join-target-exam" className="text-xs font-semibold text-slate-700">
                  Target Exam
                </Label>
                <select
                  id="join-target-exam"
                  value={targetExam}
                  onChange={(e) => setTargetExam(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                >
                  {COHORT_EXAM_CATEGORIES.map((exam) => (
                    <option key={exam} value={exam}>
                      {exam}
                    </option>
                  ))}
                  {!COHORT_EXAM_CATEGORIES.includes(targetExam as (typeof COHORT_EXAM_CATEGORIES)[number]) && (
                    <option value={targetExam}>{targetExam}</option>
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="join-target-year" className="text-xs font-semibold text-slate-700">
                  Target Admission Year
                </Label>
                <Input
                  id="join-target-year"
                  type="number"
                  min={2025}
                  max={2032}
                  value={targetAcademicYear}
                  onChange={(e) => setTargetAcademicYear(Number(e.target.value))}
                  required
                  className="h-10 rounded-xl bg-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="join-current-class" className="text-xs font-semibold text-slate-700">
                Current Class / Prep Stage
              </Label>
              <Input
                id="join-current-class"
                value={currentClass}
                onChange={(e) => setCurrentClass(e.target.value)}
                placeholder="e.g., Class 11, Class 12, Dropper, Graduate"
                required
                className="h-10 rounded-xl bg-white"
              />
            </div>
          </div>

          {/* Minor & DPDPA Parental Consent */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isMinor}
                onChange={(e) => setIsMinor(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong className="text-slate-900">Applicant is under 18 years of age</strong>{" "}
                (DPDPA 2023: parent/guardian contact is recorded for awareness; verifiable parental
                consent will be required before accepting a commercial offer).
              </span>
            </label>

            {isMinor && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="join-parent-name" className="text-xs font-semibold text-slate-700">
                    Parent / Guardian Name
                  </Label>
                  <Input
                    id="join-parent-name"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    placeholder="Full name of parent/guardian"
                    required={isMinor}
                    className="h-10 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="join-parent-phone" className="text-xs font-semibold text-slate-700">
                    Parent Mobile (10-digit Indian)
                  </Label>
                  <Input
                    id="join-parent-phone"
                    type="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    placeholder="e.g., 9876543210"
                    required={isMinor}
                    className="h-10 rounded-xl"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Fallback Policy Disclosure */}
          {fallbackPolicy && (
            <div className={`rounded-2xl border p-3.5 text-xs ${policyMeta.toneClass}`}>
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Institute Shortfall Policy: {policyMeta.label}</span>
              </div>
              <p className="mt-1 leading-relaxed opacity-90">{policyMeta.studentExplanation}</p>
            </div>
          )}

          {/* Level 3: Explicit Intent Confirmation */}
          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 cursor-pointer hover:bg-amber-50 transition-colors">
            <input
              type="checkbox"
              checked={confirmIntent}
              onChange={(e) => setConfirmIntent(e.target.checked)}
              required
              className="mt-1 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-xs text-slate-800 leading-relaxed">
              <strong className="text-slate-950 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                Level 3 · Explicit Admission Intent
              </strong>
              I confirm I genuinely plan to join{" "}
              <strong>{cohort.instituteName} ({cohort.batchName})</strong> for{" "}
              <strong>{targetAcademicYear}</strong> if the group offer matches expectations. My
              phone number stays private from other students.
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-full h-11 px-5"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !confirmIntent}
              className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold h-11 px-6 shadow-md shadow-amber-500/20"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Joining Cohort...
                </>
              ) : (
                "Confirm Intent & Join Cohort"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
