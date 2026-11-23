import React from "react";
import Link from "next/link";
import { Metadata } from "next";
import {
  Users,
  ArrowLeft,
  Compass,
  Sparkles,
  MapPin,
  Target,
  MessageCircle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { getNearbyBuddies } from "@/lib/community/buddies";
import { getRelevantInstitutesForCommunity } from "@/lib/community/lead-funnel";
import { BuddyCard } from "@/components/community/BuddyCard";
import { BuddyFilter } from "@/components/community/BuddyFilter";
import { EditBuddyProfileModal } from "@/components/community/EditBuddyProfileModal";
import { CommunityLeadBanner } from "@/components/community/CommunityLeadBanner";
import { FeaturedInstitutesRail } from "@/components/community/FeaturedInstitutesRail";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Find Nearby Study Buddies & Aspirants | AcademyFind",
  description:
    "Connect with serious students in your city or coaching cluster preparing for JEE, NEET, UPSC, and CAT. Pair up for accountability, notes sharing, and doubt solving.",
};

interface BuddiesPageProps {
  searchParams: Promise<{
    exam?: string;
    city?: string;
    tag?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function NearbyBuddiesPage({ searchParams }: BuddiesPageProps) {
  const params = await searchParams;
  const examCategory = params.exam || "ALL";
  const city = params.city || "ALL";
  const tag = params.tag || "ALL";
  const search = params.q || "";
  const page = params.page ? parseInt(params.page, 10) : 1;

  const [
    { buddies = [], total = 0 },
    { institutes = [] },
  ] = await Promise.all([
    getNearbyBuddies({
      examCategory,
      city,
      tag,
      search,
      page,
      limit: 18,
    }),
    getRelevantInstitutesForCommunity(examCategory, city, 4),
  ]);

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      {/* Top Banner & Header */}
      <div className="border-b border-border/60 bg-linear-to-b from-amber-50/70 via-background to-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-3">
            <Link href="/community" className="hover:text-amber-600 flex items-center gap-1 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Community Hub
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-bold">Study Buddies</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">
                <Compass className="w-3.5 h-3.5" />
                Hyperlocal Peer Discovery
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Find Serious Study Buddies
              </h1>
              <p className="text-sm text-slate-500 mt-1 max-w-xl">
                Never prepare alone. Match with accountable peers in your coaching hub or city preparing for the same competitive exam.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <EditBuddyProfileModal />
            </div>
          </div>

          {/* How Peer Matching Works Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-5 border-t border-slate-200/60">
            <div className="flex items-center gap-2.5 bg-white/80 backdrop-blur-xs p-3 rounded-xl border border-slate-200/70 text-xs">
              <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-slate-800">Same Target Exam</p>
                <p className="text-[11px] text-slate-500">Filter peers in JEE, NEET, UPSC, CA & CAT</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-white/80 backdrop-blur-xs p-3 rounded-xl border border-slate-200/70 text-xs">
              <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-slate-800">Coaching Clusters</p>
                <p className="text-[11px] text-slate-500">Find peers in Kota, Delhi, Hyderabad & nearby</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-white/80 backdrop-blur-xs p-3 rounded-xl border border-slate-200/70 text-xs">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <MessageCircle className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-slate-800">Direct Chat & Doubts</p>
                <p className="text-[11px] text-slate-500">Connect to open dedicated chat & exchange notes</p>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="mt-6">
            <BuddyFilter />
          </div>
        </div>
      </div>

      {/* Main Buddies Grid */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-5">
          <span>
            Showing {buddies.length} of {total} aspirants actively seeking study partners
          </span>
          {examCategory !== "ALL" && (
            <span className="bg-amber-50 text-amber-800 font-bold px-2.5 py-0.5 rounded-full border border-amber-200">
              Exam: {examCategory}
            </span>
          )}
        </div>

        {buddies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {buddies.map((buddy: (typeof buddies)[number]) => (
              <BuddyCard key={buddy.id} buddy={buddy} />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center space-y-3 mt-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg text-slate-900">No Study Buddies Found Yet</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Be the first to set your exam preferences in this area so peers preparing for the same exam can discover and connect with you!
            </p>
            <div className="pt-2">
              <EditBuddyProfileModal
                trigger={
                  <Button className="rounded-full bg-amber-500 hover:bg-amber-600 text-white font-semibold">
                    Set Up My Study Profile
                  </Button>
                }
              />
            </div>
          </div>
        )}

        {/* ─── Community Lead Generation Funnel ────────────────── */}
        <div className="mt-14 space-y-8">
          <CommunityLeadBanner
            examCategory={examCategory !== "ALL" ? examCategory : "JEE & NEET"}
            city={city !== "ALL" ? city : "your city"}
            defaultInstitute={institutes[0] || null}
            availableInstitutes={institutes}
          />
          <FeaturedInstitutesRail
            institutes={institutes}
            examCategory={examCategory !== "ALL" ? examCategory : "Competitive Exams"}
          />
        </div>
      </div>
    </div>
  );
}

