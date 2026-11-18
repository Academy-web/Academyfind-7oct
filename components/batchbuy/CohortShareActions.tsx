"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { buildWhatsAppShareUrl } from "@/lib/batchbuy/cohortValidation";

interface CohortShareActionsProps {
  cohortCode: string;
  title: string;
  instituteName: string;
  batchName: string;
  currentCount: number;
  targetSize: number;
  maxDiscountPct?: number | null;
  conversationId?: string | null;
  isMember?: boolean;
  compact?: boolean;
}

export function CohortShareActions({
  cohortCode,
  title,
  instituteName,
  batchName,
  currentCount,
  targetSize,
  maxDiscountPct,
  conversationId,
  isMember = false,
  compact = false,
}: CohortShareActionsProps) {
  const [copied, setCopied] = useState(false);

  const getOrigin = () =>
    typeof window !== "undefined" ? window.location.origin : "https://academyfind.com";

  const handleCopyLink = async () => {
    const shareUrl = `${getOrigin()}/batchbuy/${encodeURIComponent(cohortCode)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Cohort invite link copied!");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error("Could not copy link. Please copy from address bar.");
    }
  };

  const handleWhatsAppShare = () => {
    const waUrl = buildWhatsAppShareUrl({
      cohortCode,
      title,
      instituteName,
      batchName,
      currentCount,
      targetSize,
      maxDiscountPct,
      baseUrl: getOrigin(),
    });
    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${compact ? "" : "w-full"}`}>
      <button
        type="button"
        onClick={handleWhatsAppShare}
        className={`inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all duration-200 shadow-sm shadow-emerald-600/20 hover:-translate-y-0.5 cursor-pointer ${
          compact ? "px-4 h-10" : "flex-1 min-w-[180px] px-5 h-11"
        }`}
      >
        <Share2 className="w-4 h-4 shrink-0" />
        <span>Share on WhatsApp</span>
      </button>

      <button
        type="button"
        onClick={handleCopyLink}
        className={`inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-300 text-slate-700 font-semibold text-sm transition-all duration-200 cursor-pointer ${
          compact ? "px-4 h-10" : "px-5 h-11"
        }`}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-emerald-700">Copied</span>
          </>
        ) : (
          <>
            <Copy className="w-4 h-4 shrink-0 text-slate-500" />
            <span>Copy Link</span>
          </>
        )}
      </button>

      {isMember && conversationId && (
        <Link
          href={`/chat/${conversationId}`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-300/80 bg-amber-50/90 hover:bg-amber-100 text-amber-900 font-bold text-sm px-5 h-11 transition-all duration-200"
        >
          <MessageCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Open Cohort Study Chat</span>
        </Link>
      )}
    </div>
  );
}
