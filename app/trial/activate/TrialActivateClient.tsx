"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  Trophy,
  BarChart3,
  Users,
  ShieldCheck,
  ArrowRight,
  Clock,
  AlertCircle,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrialActivateClientProps {
  initialState: "READY" | "ACTIVE" | "ALREADY_PAID" | "EXPIRED" | "INVALID";
  instituteId: string | null;
  instituteName: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
}

const ELITE_PERKS = [
  {
    icon: Trophy,
    title: "Top Search Position",
    desc: "Appear at the top in your city and category searches for maximum student visibility.",
  },
  {
    icon: BarChart3,
    title: "Lead Management System (LMS)",
    desc: "Capture, organize, and convert student enquiries with real-time notifications.",
  },
  {
    icon: Users,
    title: "Visitor Contact Details",
    desc: "See interested students & parents who viewed your profile even without submitting a form.",
  },
  {
    icon: Crown,
    title: "Full Profile Showcase",
    desc: "Add up to 50 faculty members, classroom gallery, student results, and videos.",
  },
];

export default function TrialActivateClient({
  initialState,
  instituteId,
  instituteName,
  expiresAt: initialExpiresAt,
  daysRemaining: initialDaysRemaining,
}: TrialActivateClientProps) {
  const [state, setState] = useState(initialState);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [daysRemaining, setDaysRemaining] = useState(initialDaysRemaining);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trial/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "token" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Unable to activate trial right now.");
        return;
      }
      setExpiresAt(data.expiresAt || null);
      setDaysRemaining(7);
      setState("ACTIVE");
    } catch {
      setError("Network error while activating your trial. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const dashboardHref = instituteId
    ? `/login?callbackUrl=${encodeURIComponent(`/manager/${instituteId}`)}`
    : "/manager";

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-[#fffcf5] to-orange-50/70 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-3xl bg-white/80 backdrop-blur-xl border border-amber-200/80 rounded-3xl shadow-[0_20px_60px_-15px_rgba(217,119,6,0.16)] p-6 sm:p-10 transition-all duration-300">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-amber-100 pb-5 mb-7">
          <Link href="/" className="text-xl font-black tracking-tight text-amber-600">
            AcademyFind
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            7-Day Elite (ULTRA) Trial
          </span>
        </div>

        {state === "INVALID" && (
          <div className="text-center py-8 space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black text-slate-900">Invalid or Expired Link</h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              This trial activation link is invalid or has expired. You can still log in to your
              Manager Dashboard to check your institute&apos;s eligibility.
            </p>
            <div className="pt-2">
              <Button asChild className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-6 py-5 font-bold">
                <Link href="/login">
                  Log In to Manager Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {state === "EXPIRED" && (
          <div className="text-center py-8 space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Clock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black text-slate-900">
              Free Trial Already Used {instituteName ? `for ${instituteName}` : ""}
            </h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              This institute has already used its 7-day Elite free trial. Explore our flexible plans
              to restore priority ranking and student leads.
            </p>
            <div className="pt-2">
              <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-6 py-5 font-bold">
                <Link href={instituteId ? `/manager/${instituteId}/subscription` : "/manager"}>
                  View Subscription Plans <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {state === "ALREADY_PAID" && (
          <div className="text-center py-8 space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black text-slate-900">
              {instituteName || "Your Institute"} Already Has an Active Paid Plan
            </h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Your paid subscription is already active and protected. Open your Manager Dashboard to
              manage leads and analytics.
            </p>
            <div className="pt-2">
              <Button asChild className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-6 py-5 font-bold">
                <Link href={dashboardHref}>
                  Open Manager Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {state === "READY" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Unlock 7 Days of Elite (ULTRA) Free for{" "}
                <span className="text-amber-600">{instituteName}</span>
              </h1>
              <p className="text-sm sm:text-base text-slate-600">
                No credit or debit card required. Click below to start your 7-day trial immediately
                and experience top search rankings and real-time student leads.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {ELITE_PERKS.map((perk) => (
                <div
                  key={perk.title}
                  className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                      <perk.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{perk.title}</h3>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{perk.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 font-medium">
                {error}
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-amber-100">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                Auto-moves to Basic after 7 days unless you upgrade. Zero data deleted.
              </div>
              <Button
                onClick={handleActivate}
                disabled={loading}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black rounded-2xl px-7 py-6 text-base shadow-lg shadow-amber-500/25 cursor-pointer shrink-0"
              >
                {loading ? "Activating..." : "Activate 7-Day Free Trial"}
              </Button>
            </div>
          </div>
        )}

        {state === "ACTIVE" && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-amber-50 border border-emerald-200 p-5 flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                    Your 7-Day Elite Trial Has Started!
                  </h1>
                  <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-950">
                    {daysRemaining ?? 7} days left
                  </span>
                </div>
                <p className="text-sm text-slate-700 mt-1">
                  <strong>{instituteName}</strong> is now boosted to <strong>Elite (ULTRA)</strong>{" "}
                  {formattedExpiry ? `until ${formattedExpiry}` : "for 7 days"}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ELITE_PERKS.map((perk) => (
                <div
                  key={perk.title}
                  className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 p-3.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">{perk.title}</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">{perk.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-amber-100">
              <Link
                href={instituteId ? `/manager/${instituteId}/subscription` : "/manager"}
                className="text-xs font-bold text-amber-800 hover:underline"
              >
                View Subscription &amp; Upgrade Options
              </Link>
              <Button
                asChild
                className="bg-slate-900 hover:bg-slate-800 text-white font-black rounded-2xl px-7 py-6 text-sm sm:text-base w-full sm:w-auto"
              >
                <Link href={dashboardHref}>
                  Open Manager Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
