"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PublicCohortCardDTO,
  SearchInstituteBatchOption,
} from "@/lib/batchbuy/cohortQueries";
import { SlabResolutionResult } from "@/lib/batchbuy/slabResolver";
import { CohortCard } from "./CohortCard";
import { CreateCohortModal } from "./CreateCohortModal";
import { getFallbackPolicyMeta } from "./fallbackPolicyInfo";

interface InstituteBatchBuySectionProps {
  institute: SearchInstituteBatchOption;
  cohorts: PublicCohortCardDTO[];
  defaultSlabs: SlabResolutionResult;
  isLoggedIn: boolean;
  accountPhoneVerified: boolean;
  profilePrefill?: {
    targetExam?: string | null;
    targetYear?: number | null;
    currentClass?: string | null;
  };
  institutePath: string;
}

export function InstituteBatchBuySection({
  institute,
  cohorts,
  defaultSlabs,
  isLoggedIn,
  accountPhoneVerified,
  profilePrefill,
  institutePath,
}: InstituteBatchBuySectionProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const hasBatches = institute.batches.length > 0;
  const hasSlabs = defaultSlabs.slabs.length > 0;

  if (!hasBatches && cohorts.length === 0 && !hasSlabs) {
    return null;
  }

  const fallbackPolicy = defaultSlabs.slabs[0]?.fallbackPolicy || null;
  const policyMeta = getFallbackPolicyMeta(fallbackPolicy);

  return (
    <section
      id="batchbuy"
      className="scroll-mt-32 rounded-3xl border border-amber-200/80 bg-linear-to-br from-amber-50/70 via-white to-orange-50/40 p-6 sm:p-8 shadow-[0_12px_40px_rgba(251,191,36,0.08)] space-y-6"
    >
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-800 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span>BatchBuy™ Group Admissions</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Save Together at{" "}
            <span className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 bg-clip-text text-transparent">
              {institute.name}
            </span>
          </h2>
          <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
            Join an existing student cohort or start a new one for any batch below. Unlock group
            discounts with zero advance fees on AcademyFind.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {hasBatches && (
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-sm px-6 h-11 shadow-md shadow-amber-500/20 hover:-translate-y-0.5 transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Start BatchBuy Group
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            className="rounded-full border-amber-200 bg-white hover:bg-amber-50 text-amber-900 font-bold text-sm px-5 h-11"
          >
            <Link href="/batchbuy">
              <span>All Cohorts</span>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Institute Published Slab Strip */}
      {hasSlabs && (
        <div className="rounded-2xl border border-amber-200/80 bg-white/90 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <Tag className="w-4 h-4 text-amber-600" />
              <span>Partner Group Discount Tiers</span>
            </div>
            {fallbackPolicy && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-800"
                title={policyMeta.studentExplanation}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                {policyMeta.shortBadge}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {defaultSlabs.slabs.map((slab) => (
              <div
                key={slab.id}
                className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-bold text-slate-600">
                    {slab.minStudents}
                    {slab.maxStudents ? `–${slab.maxStudents}` : "+"} Students
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {slab.waiveRegistration ? "Reg. Fee Waived" : "Standard Reg."}
                  </div>
                </div>
                <div className="text-lg font-extrabold text-amber-700">
                  {slab.discountPercentage}% OFF
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Cohorts Grid or Prompt */}
      {cohorts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {cohorts.map((cohort) => (
            <CohortCard key={cohort.id} cohort={cohort} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-amber-300/80 bg-white/80 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">
                No active cohort for {institute.name} yet
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 mt-1">
                Be the cohort founder — pick your batch, get an instant study group chat &amp;
                WhatsApp invite link, and rally 5–15 classmates.
              </p>
            </div>
          </div>

          {hasBatches && (
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold px-5 h-11 shrink-0 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Launch First Cohort
            </Button>
          )}
        </div>
      )}

      <CreateCohortModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        isLoggedIn={isLoggedIn}
        accountPhoneVerified={accountPhoneVerified}
        profilePrefill={profilePrefill}
        presetInstitute={institute}
        callbackPath={institutePath}
      />
    </section>
  );
}
