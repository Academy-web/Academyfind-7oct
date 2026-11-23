"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Sparkles,
  BookOpen,
  MessageCircle,
  UserPlus,
  Clock,
  Check,
  Loader2,
  GraduationCap,
  Languages,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendBuddyRequest, respondBuddyRequest } from "@/lib/community/buddies";
import toast from "react-hot-toast";

interface BuddyCardProps {
  buddy: {
    id: string;
    userId: string;
    headline?: string | null;
    bio?: string | null;
    targetExam?: string | null;
    targetYear?: number | null;
    currentClass?: string | null;
    city?: string | null;
    locality?: string | null;
    preferredMedium?: string | null;
    subjects?: string[];
    tags?: string[];
    distanceKm?: number | null;
    relationship?: {
      requestId: string;
      status: string;
      isSender: boolean;
    } | null;
    user: {
      id: string;
      name?: string | null;
      username?: string | null;
      image?: string | null;
    };
  };
}

export function BuddyCard({ buddy }: BuddyCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [relation, setRelation] = useState(buddy.relationship);

  const getExamBadge = (category?: string | null) => {
    switch (category?.toUpperCase()) {
      case "JEE":
        return {
          bg: "bg-amber-50 text-amber-800 border-amber-200/80",
          iconColor: "text-amber-600",
        };
      case "NEET":
        return {
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
          iconColor: "text-emerald-600",
        };
      case "UPSC":
        return {
          bg: "bg-indigo-50 text-indigo-800 border-indigo-200/80",
          iconColor: "text-indigo-600",
        };
      case "CAT":
      case "GATE":
        return {
          bg: "bg-orange-50 text-orange-800 border-orange-200/80",
          iconColor: "text-orange-600",
        };
      case "CA FOUNDATION":
      case "CA":
        return {
          bg: "bg-purple-50 text-purple-800 border-purple-200/80",
          iconColor: "text-purple-600",
        };
      default:
        return {
          bg: "bg-slate-100 text-slate-800 border-slate-200",
          iconColor: "text-slate-500",
        };
    }
  };

  const badgeStyle = getExamBadge(buddy.targetExam);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res = await sendBuddyRequest(buddy.userId);
      if (res.success) {
        setRelation({
          requestId: "temp",
          status: res.status || "PENDING",
          isSender: true,
        });
        toast.success(`Study buddy request sent to ${buddy.user.name || "student"}!`);
      } else {
        toast.error(res.error || "Failed to send request.");
      }
    } catch (err) {
      toast.error("Please log in to connect with study buddies.");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId: string) => {
    setLoading(true);
    try {
      const res = await respondBuddyRequest(requestId, "ACCEPT");
      if (res.success) {
        setRelation((prev) => (prev ? { ...prev, status: "ACCEPTED" } : null));
        toast.success("Study buddy request accepted!");
        if (res.conversationId) {
          router.push(`/chat/${res.conversationId}`);
        }
      } else {
        toast.error(res.error || "Could not accept request.");
      }
    } catch (err) {
      toast.error("An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md p-5 sm:p-5.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:border-amber-300/80 hover:bg-white hover:shadow-[0_16px_36px_rgba(245,158,11,0.10)] hover:-translate-y-1">
      {/* Ambient subtle corner glow on hover */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/10 blur-xl group-hover:bg-amber-400/25 transition-all" />

      <div>
        {/* Top Header: Avatar + Details + Exam Badge */}
        <div className="flex items-start justify-between gap-3 mb-3.5">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar with status indicator */}
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-white flex items-center justify-center font-bold text-base shadow-xs uppercase ring-2 ring-white">
                {buddy.user.image ? (
                  <img
                    src={buddy.user.image}
                    alt={buddy.user.name || "Student"}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  buddy.user.name?.charAt(0) || "S"
                )}
              </div>
              {/* Online / Active to study dot */}
              <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-1 ring-white" />
              </span>
            </div>

            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 text-base leading-snug truncate group-hover:text-amber-600 transition-colors">
                {buddy.user.name || "Aspirant"}
              </h3>
              <p className="text-xs text-slate-400 font-medium truncate">
                @{buddy.user.username || "student"}
              </p>
            </div>
          </div>

          {/* Exam Tag */}
          {buddy.targetExam && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border tracking-wide uppercase shrink-0 shadow-2xs ${badgeStyle.bg}`}
            >
              <Sparkles className={`w-3 h-3 ${badgeStyle.iconColor}`} />
              {buddy.targetExam} {buddy.targetYear ? `'${String(buddy.targetYear).slice(-2)}` : ""}
            </span>
          )}
        </div>

        {/* Location & Coaching Cluster Pill */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 mb-3 bg-slate-50/80 border border-slate-100/80 rounded-xl px-2.5 py-1.5">
          <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          <span className="font-medium truncate">
            {buddy.locality ? `${buddy.locality}, ` : ""}
            {buddy.city || "Online / Pan-India"}
          </span>
          {buddy.distanceKm !== null && (
            <span className="ml-auto inline-flex items-center px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
              ~{buddy.distanceKm} km
            </span>
          )}
        </div>

        {/* Headline or Bio */}
        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-3">
          {buddy.headline || buddy.bio || "Preparing seriously for upcoming entrance examinations. Looking for accountable study buddies."}
        </p>

        {/* Interest Tags */}
        {buddy.tags && buddy.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {buddy.tags.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-50/90 border border-amber-200/80 px-2 py-0.5 rounded-full"
              >
                <Tag className="w-2.5 h-2.5 text-amber-600" />
                {tag}
              </span>
            ))}
            {buddy.tags.length > 3 && (
              <span className="text-[10px] text-slate-400 font-semibold">
                +{buddy.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Focus Subjects */}
        {buddy.subjects && buddy.subjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3.5">
            {buddy.subjects.slice(0, 3).map((sub: string) => (
              <span
                key={sub}
                className="text-[11px] font-medium text-slate-700 bg-amber-50/70 border border-amber-200/50 px-2 py-0.5 rounded-md"
              >
                {sub}
              </span>
            ))}
          </div>
        )}

        {/* Quick Meta (Medium & Year) */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium mb-1">
          {buddy.preferredMedium && (
            <span className="flex items-center gap-1">
              <Languages className="w-3 h-3 text-slate-400" />
              {buddy.preferredMedium} Medium
            </span>
          )}
          {buddy.targetYear && (
            <span className="flex items-center gap-1">
              <GraduationCap className="w-3 h-3 text-slate-400" />
              Class of {buddy.targetYear}
            </span>
          )}
        </div>
      </div>

      {/* Action Button Footer */}
      <div className="pt-3.5 border-t border-slate-100 mt-2">
        {relation?.status === "ACCEPTED" ? (
          <Button
            size="sm"
            onClick={() => router.push("/chat")}
            className="w-full rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold h-9 gap-1.5 shadow-xs"
          >
            <MessageCircle className="w-3.5 h-3.5 text-amber-400" />
            Message Study Buddy
          </Button>
        ) : relation?.status === "PENDING" && relation.isSender ? (
          <Button
            size="sm"
            disabled
            variant="outline"
            className="w-full rounded-full text-slate-500 text-xs font-medium h-9 gap-1.5 cursor-default bg-slate-50 border-slate-200"
          >
            <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin" />
            Request Sent (Pending)
          </Button>
        ) : relation?.status === "PENDING" && !relation.isSender ? (
          <Button
            size="sm"
            onClick={() => handleAccept(relation.requestId)}
            disabled={loading}
            className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-9 gap-1.5 shadow-sm"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Accept Buddy Request
              </>
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={loading}
            className="w-full rounded-full bg-linear-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-bold h-9 gap-1.5 shadow-sm shadow-amber-500/20 hover:shadow-md hover:shadow-amber-500/30 transition-all hover:-translate-y-0.5"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-3.5 h-3.5" />
                Connect to Study
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

