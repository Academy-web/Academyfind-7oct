import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  GraduationCap,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { PublicCohortCardDTO } from "@/lib/batchbuy/cohortQueries";
import { formatINR, getDaysRemainingLabel, getFallbackPolicyMeta } from "./fallbackPolicyInfo";

export function CohortCard({ cohort }: { cohort: PublicCohortCardDTO }) {
  const fillPercent = Math.min(
    100,
    Math.round((cohort.activeMemberCount / Math.max(1, cohort.targetSize)) * 100)
  );
  const spotsRemaining = Math.max(0, cohort.targetSize - cohort.activeMemberCount);
  const timeInfo = getDaysRemainingLabel(cohort.formingExpiresAt);
  const { currentSlab, nextSlab, studentsToNextSlab, maxDiscountPercentage, fallbackPolicy } =
    cohort.slabProgress;
  const policyMeta = getFallbackPolicyMeta(fallbackPolicy);

  return (
    <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 backdrop-blur-md p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.03)] transition-all duration-300 ease-out hover:border-amber-300/90 hover:bg-white hover:shadow-[0_20px_45px_rgba(251,191,36,0.14)] hover:-translate-y-1.5">
      {/* Ambient subtle corner glow on hover */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl group-hover:bg-amber-400/20 transition-all" />

      <div className="space-y-4">
        {/* Top Metadata Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/90 bg-amber-50/90 px-3 py-1 text-[11px] font-bold text-amber-800">
            <GraduationCap className="w-3.5 h-3.5 text-amber-600" />
            <span>{cohort.examCategory}</span>
            <span className="text-amber-400">&bull;</span>
            <span>{cohort.targetAcademicYear}</span>
          </div>

          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] font-bold text-slate-700">
            {cohort.cohortCode}
          </span>
        </div>

        {/* Institute Identity */}
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 shrink-0 rounded-xl border border-slate-200/80 bg-amber-50/50 overflow-hidden flex items-center justify-center">
            {cohort.institute.logo ? (
              <Image
                src={cohort.institute.logo}
                alt={cohort.institute.name}
                width={44}
                height={44}
                className="h-full w-full object-cover"
              />
            ) : (
              <Users className="w-5 h-5 text-amber-600" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-base text-slate-900 leading-snug line-clamp-2 group-hover:text-amber-700 transition-colors">
              {cohort.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-800 inline-flex items-center gap-1 truncate">
                {cohort.institute.name}
                {cohort.institute.verified && (
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                )}
              </span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <MapPin className="w-3 h-3" />
                {cohort.institute.cityName}
              </span>
            </div>
          </div>
        </div>

        {/* Batch & Fee Pill */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Batch
            </div>
            <div className="font-bold text-slate-800 truncate">{cohort.batch.name}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Listed Fee
            </div>
            <div className="font-extrabold text-slate-900">{formatINR(cohort.batch.fee)}</div>
          </div>
        </div>

        {/* Collective Progress Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-amber-600" />
              {cohort.activeMemberCount} / {cohort.targetSize} joined
            </span>
            <span className="font-semibold text-amber-700">
              {spotsRemaining > 0
                ? `${spotsRemaining} more to target`
                : "Target size reached"}
            </span>
          </div>

          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={fillPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Cohort member progress"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-500 to-orange-500 transition-all duration-500"
              style={{ width: `${Math.max(8, fillPercent)}%` }}
            />
          </div>

          {/* Discount Slab Highlight */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 text-[11px]">
            {currentSlab ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-bold text-emerald-700">
                <Sparkles className="w-3 h-3" />
                Unlocked: {currentSlab.discountPercentage}% OFF
              </span>
            ) : maxDiscountPercentage > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-bold text-amber-800">
                <Sparkles className="w-3 h-3" />
                Up to {maxDiscountPercentage}% OFF
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-600">
                Demand Proposal ({cohort.minRequired}+ quorum)
              </span>
            )}

            {nextSlab && studentsToNextSlab > 0 && (
              <span className="text-slate-500 font-medium">
                +{studentsToNextSlab} for {nextSlab.discountPercentage}% tier
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer CTA & Trust Disclosure */}
      <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            {timeInfo.label}
          </span>
          {fallbackPolicy && (
            <span
              className="inline-flex items-center gap-1 font-semibold text-slate-600"
              title={policyMeta.studentExplanation}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              {policyMeta.shortBadge}
            </span>
          )}
        </div>

        <Link
          href={`/batchbuy/${cohort.cohortCode}`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-sm h-11 px-5 shadow-md shadow-amber-500/15 hover:shadow-lg hover:shadow-amber-500/25 transition-all"
        >
          <span>View Cohort &amp; Join</span>
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
