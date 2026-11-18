import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
import { getPublicCohorts } from "@/lib/batchbuy/cohortQueries";
import { CohortDiscoveryClient } from "@/components/batchbuy/CohortDiscoveryClient";
import { BadgeCheck, ShieldCheck, Sparkles, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BatchBuy™ Student Group Admissions | Save Together on Coaching Fees | AcademyFind",
  description:
    "Join verified student cohorts for JEE, NEET, UPSC, CAT & GATE coaching institutes across India. Unlock collective group fee discounts with zero booking fees on AcademyFind.",
};

export default async function BatchBuyDiscoveryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  const [cohorts, viewer] = await Promise.all([
    getPublicCohorts({ status: "ALL_ACTIVE", limit: 36 }),
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: {
            phoneVerified: true,
            studentProfile: {
              select: {
                targetExam: true,
                targetYear: true,
                currentClass: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-screen bg-linear-to-b from-amber-50/70 via-background to-background pb-20">
      {/* Ambient Hero */}
      <section className="relative overflow-hidden border-b border-amber-100/80 pt-10 pb-12 sm:pt-14 sm:pb-16">
        <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-amber-200/35 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 right-1/4 h-64 w-64 rounded-full bg-orange-200/25 blur-[75px]" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 space-y-8">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-white/90 px-3.5 py-1 text-xs font-bold text-amber-800 shadow-2xs backdrop-blur-xs">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>AcademyFind BatchBuy™ Collective Admissions</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
              Never Enroll Alone.{" "}
              <span className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 bg-clip-text text-transparent">
                Join Fellow Aspirants &amp; Unlock Group Slabs.
              </span>
            </h1>

            <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-2xl">
              Team up with students joining the same coaching institute and batch. Coaching centers
              lower their acquisition cost and reward verified cohorts with tiered fee discounts,
              registration waivers, and study perks — with{" "}
              <strong className="text-slate-900">₹0 upfront payment</strong> on AcademyFind.
            </p>
          </div>

          {/* 3-Pillar Zero-Token Trust Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-amber-200/70 bg-white/80 backdrop-blur-md p-4 flex items-start gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">₹0 Platform Advance</h2>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  No booking tokens or escrow deposits. Pay your discounted fee directly at the
                  institute counter.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200/70 bg-white/80 backdrop-blur-md p-4 flex items-start gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <BadgeCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">3-Level Verified Intent</h2>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  Mobile OTP, course fit, and explicit intent ensure serious cohorts institutes
                  respect.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200/70 bg-white/80 backdrop-blur-md p-4 flex items-start gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Private Group Chat &amp; WhatsApp</h2>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  Every cohort gets an instant AcademyFind study chat plus 1-click WhatsApp invites.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Discovery Grid */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 pt-8 sm:pt-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
              Active Forming Cohorts ({cohorts.length})
            </h2>
          </div>
        </div>

        <CohortDiscoveryClient
          initialCohorts={cohorts}
          isLoggedIn={Boolean(userId)}
          accountPhoneVerified={Boolean(viewer?.phoneVerified)}
          profilePrefill={viewer?.studentProfile || undefined}
        />
      </section>
    </main>
  );
}
