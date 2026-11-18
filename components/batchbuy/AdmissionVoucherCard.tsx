"use client";

import React, { useState } from "react";
import QRCode from "react-qr-code";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  Clock,
  Copy,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  XCircle,
} from "lucide-react";
import type { SerializedIssuedVoucher } from "@/lib/batchbuy/offerActions";
import { getFallbackPolicyMeta } from "./fallbackPolicyInfo";

function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

interface AdmissionVoucherCardProps {
  voucher: SerializedIssuedVoucher;
}

export function AdmissionVoucherCard({ voucher }: AdmissionVoucherCardProps) {
  const [copied, setCopied] = useState(false);
  const policyMeta = getFallbackPolicyMeta(voucher.fallbackPolicy);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(voucher.voucherCode);
      setCopied(true);
      toast.success("Voucher code copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Unable to copy voucher code.");
    }
  };

  const badgeConfig = (() => {
    switch (voucher.effectiveStatus) {
      case "ACTIVE":
        return {
          pill: "bg-emerald-600 text-white",
          border: "border-emerald-300 bg-gradient-to-br from-white via-emerald-50/40 to-amber-50/40",
          label: "ACTIVE · ELIGIBLE FOR ADMISSION",
          Icon: ShieldCheck,
        };
      case "PENDING_QUORUM":
        return {
          pill: "bg-amber-600 text-white",
          border: "border-amber-300 bg-gradient-to-br from-white via-amber-50/60 to-orange-50/30",
          label: `ISSUED · AWAITING QUORUM (${voucher.acceptedCount}/${voucher.minAcceptanceQuorum})`,
          Icon: Clock,
        };
      case "EXPIRED":
        return {
          pill: "bg-rose-600 text-white",
          border: "border-rose-200 bg-rose-50/30",
          label: "EXPIRED",
          Icon: XCircle,
        };
      case "REVOKED":
        return {
          pill: "bg-rose-700 text-white",
          border: "border-rose-200 bg-rose-50/30",
          label: "REVOKED",
          Icon: XCircle,
        };
      case "REDEEMED":
        return {
          pill: "bg-slate-800 text-white",
          border: "border-slate-300 bg-slate-50",
          label: "REDEEMED",
          Icon: CheckCircle2,
        };
    }
  })();

  const StatusIcon = badgeConfig.Icon;
  const registrationSaved = voucher.waiveRegistration ? voucher.registrationFeeOriginal : 0;
  const totalSavings = voucher.discountAmount + registrationSaved;

  return (
    <div
      className={`rounded-3xl border p-6 shadow-[0_18px_45px_rgba(251,191,36,0.12)] backdrop-blur-md space-y-5 ${badgeConfig.border}`}
    >
      {/* Top Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-800">
          <Ticket className="w-4 h-4 text-amber-600" />
          <span>AcademyFind BatchBuy™ Admission Pass · Offer v{voucher.offerVersion}</span>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold ${badgeConfig.pill}`}
        >
          <StatusIcon className="w-3.5 h-3.5" />
          <span>{badgeConfig.label}</span>
        </span>
      </div>

      {/* Main Pass Body with QR Verification */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center border-y border-dashed border-amber-300/80 py-5">
        <div className="md:col-span-8 space-y-3">
          <div>
            <div className="text-xs font-semibold text-slate-500">Bound Student &amp; Batch</div>
            <div className="text-lg font-extrabold text-slate-900">
              {voucher.studentNameSnapshot}
            </div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">
              {voucher.instituteNameSnapshot} · {voucher.batchNameSnapshot} ({voucher.cohortCode})
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="rounded-xl border border-amber-200 bg-white px-3.5 py-2 font-mono text-sm font-extrabold tracking-wider text-slate-900">
              {voucher.voucherCode}
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? "Copied" : "Copy Code"}</span>
            </button>
            <span className="rounded-xl bg-slate-100 px-2.5 py-2 text-[11px] font-mono font-bold text-slate-600">
              SIG: {voucher.verificationChecksum}
            </span>
          </div>

          <p className="text-xs text-slate-700 leading-relaxed font-medium">
            {voucher.eligibilityReason}
          </p>
        </div>

        <div className="md:col-span-4 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <QRCode
            value={voucher.qrPayload}
            size={128}
            level="M"
            title={`BatchBuy Voucher ${voucher.voucherCode}`}
          />
          <span className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Center Verification QR
          </span>
        </div>
      </div>

      {/* Immutable Financial Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3">
          <div className="text-slate-500 font-medium">Listed Base Fee</div>
          <div className="text-sm font-bold text-slate-700 line-through mt-0.5">
            {formatINR(voucher.baseFee)}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="text-emerald-700 font-semibold">
            Group Discount ({voucher.discountPercentage}%)
          </div>
          <div className="text-sm font-extrabold text-emerald-800 mt-0.5">
            -{formatINR(voucher.discountAmount)}
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="text-amber-800 font-semibold">Net Payable Tuition</div>
          <div className="text-base font-extrabold text-slate-900 mt-0.5">
            {formatINR(voucher.netPayableTuition)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3">
          <div className="text-slate-500 font-medium">Total Student Savings</div>
          <div className="text-sm font-extrabold text-emerald-700 mt-0.5">
            {formatINR(totalSavings)}
          </div>
        </div>
      </div>

      {/* Contractual Quorum & Expiry Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Acceptance Quorum:{" "}
            <strong className="text-slate-900">
              {voucher.acceptedCount}/{voucher.minAcceptanceQuorum}
            </strong>
          </span>
          <span>·</span>
          <span>
            Min Admission Quorum:{" "}
            <strong className="text-slate-900">{voucher.minAdmissionQuorum} enrolled</strong>
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <strong>{policyMeta.label}</strong>
          </span>
        </div>

        <div className="font-semibold text-slate-700">
          Valid Until:{" "}
          {new Date(voucher.expiresAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>
    </div>
  );
}
