"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  History,
  IndianRupee,
  Loader2,
  QrCode,
  ReceiptIndianRupee,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  XCircle,
} from "lucide-react";
import {
  previewVoucherForRedemptionAction,
  redeemBatchBuyVoucherAction,
  settleExpiredOfferAdmissionQuorumAction,
  cancelOrRefundBatchBuyAdmissionAction,
} from "@/lib/batchbuy/redemptionActions";
import type {
  BatchBuyAuditEntryDTO,
  BatchBuyCreditNoteDTO,
  CommissionInvoiceDTO,
  FlaggedAttributionDTO,
  InstituteVoucherLifecycleDTO,
  OfferQuorumSettlementItemDTO,
} from "@/lib/batchbuy/redemptionQueries";
import { Button } from "@/components/ui/button";

function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatInrExact(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface PreviewVoucherData {
  voucherId: string;
  voucherCode: string;
  redemptionMethod: "QR_SCAN" | "MANUAL_CODE";
  studentName: string;
  instituteName: string;
  batchName: string;
  cohortCode: string;
  cohortTitle: string;
  offerVersion: number;
  baseFee: number;
  registrationFeeOriginal: number;
  waiveRegistration: boolean;
  discountPercentage: number;
  discountAmount: number;
  netPayableTuition: number;
  includedPerks: string[];
  fallbackPolicy: string;
  minAdmissionQuorum: number;
  currentConfirmedAdmissions: number;
  projectedAdmissionsAfterRedeem: number;
  requiresDisclosureAtCounter: boolean;
  disclosedFallbackFee: number | null;
  expiresAt: string;
}

interface RedemptionWorkspaceClientProps {
  instituteId: string;
  instituteName: string;
  actorRole: string;
  isIsmRole: boolean;
  agreementsSummary: {
    hasActiveAgreement: boolean;
    activeAgreement: {
      id: string;
      version: number;
      rateTier: string;
      commissionRatePct: number;
      gstRatePct: number;
      sacCode: string | null;
      sacValidatedByCa: boolean;
      attributionWindowDays: number;
      holdingPeriodDays: number;
      paymentDueDays: number;
      acceptedRepresentativeName: string | null;
      acceptedDesignation: string | null;
      acceptedAt: string | null;
    } | null;
  };
  vouchers: InstituteVoucherLifecycleDTO[];
  offersForQuorumSettlement: OfferQuorumSettlementItemDTO[];
  attributions: FlaggedAttributionDTO[];
  invoices: CommissionInvoiceDTO[];
  creditNotes?: BatchBuyCreditNoteDTO[];
  auditLogs: BatchBuyAuditEntryDTO[];
}

export function RedemptionWorkspaceClient({
  instituteId,
  instituteName,
  actorRole,
  isIsmRole,
  agreementsSummary,
  vouchers,
  offersForQuorumSettlement,
  attributions,
  invoices,
  creditNotes = [],
  auditLogs,
}: RedemptionWorkspaceClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<
    "COUNTER" | "ENROLMENTS" | "INVOICES" | "AUDIT"
  >("COUNTER");

  // Counter scan / lookup form
  const [qrInput, setQrInput] = useState("");
  const [preview, setPreview] = useState<PreviewVoucherData | null>(null);
  const [upfrontDirectPaid, setUpfrontDirectPaid] = useState<string>("0");
  const [excludedNonTuitionAmount, setExcludedNonTuitionAmount] =
    useState<string>("0");
  const [excludedChargesNote, setExcludedChargesNote] = useState("");
  const [paymentModeNote, setPaymentModeNote] = useState("UPI / Counter Direct");
  const [admissionNote, setAdmissionNote] = useState("");
  const [shortfallDisclosureAccepted, setShortfallDisclosureAccepted] =
    useState(false);

  // Cancellation modal state
  const [cancelAdmissionTarget, setCancelAdmissionTarget] = useState<{
    admissionId: string;
    studentName: string;
    paidAmount: number;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [directRefundAmount, setDirectRefundAmount] = useState<string>("0");
  const [directRefundCompleted, setDirectRefundCompleted] = useState(false);

  const stats = useMemo(() => {
    const activeReady = vouchers.filter((v) => v.status === "ACTIVE").length;
    const redeemedCount = vouchers.filter((v) => v.status === "REDEEMED").length;
    const pendingFallbackConsent = vouchers.filter(
      (v) => v.settlementState === "PENDING_STUDENT_FALLBACK_CONSENT"
    ).length;
    const flaggedBypass = attributions.filter(
      (a) => a.matchStatus === "FLAGGED_SUSPECTED_BYPASS"
    ).length;
    return {
      activeReady,
      redeemedCount,
      pendingFallbackConsent,
      flaggedBypass,
    };
  }, [vouchers, attributions]);

  const handleLookupVoucher = () => {
    if (!qrInput.trim()) {
      toast.error("Paste signed QR JSON or enter AFBB voucher code.");
      return;
    }
    startTransition(async () => {
      const res = await previewVoucherForRedemptionAction({
        instituteId,
        qrPayloadOrCode: qrInput.trim(),
      });
      if (!res.success || !res.preview) {
        setPreview(null);
        toast.error(res.error || "Voucher verification failed.");
        return;
      }
      setPreview(res.preview);
      setUpfrontDirectPaid(String(res.preview.netPayableTuition));
      setExcludedNonTuitionAmount("0");
      setExcludedChargesNote("");
      setShortfallDisclosureAccepted(false);
      toast.success(
        `Verified voucher ${res.preview.voucherCode} for ${res.preview.studentName}`
      );
    });
  };

  const handleConfirmRedemption = () => {
    if (!preview) return;
    if (preview.requiresDisclosureAtCounter && !shortfallDisclosureAccepted) {
      toast.error(
        "You must confirm verbal & written fallback policy disclosure before redeeming this voucher."
      );
      return;
    }

    startTransition(async () => {
      const res = await redeemBatchBuyVoucherAction({
        instituteId,
        qrPayloadOrCode: qrInput.trim(),
        redemptionMethod: preview.redemptionMethod,
        upfrontDirectPaid: Number(upfrontDirectPaid || 0),
        excludedNonTuitionAmount: Number(excludedNonTuitionAmount || 0),
        excludedChargesNote: excludedChargesNote.trim() || null,
        shortfallDisclosureAccepted,
        admissionNote: admissionNote.trim() || null,
        paymentModeNote: paymentModeNote.trim() || null,
      });

      if (!res.success) {
        toast.error(res.error || "Redemption failed.");
        return;
      }

      toast.success(
        `Admission confirmed for ${preview.studentName}! Ledger held under 15-day cooling-off.`
      );
      setPreview(null);
      setQrInput("");
      setShortfallDisclosureAccepted(false);
      router.refresh();
    });
  };

  const handleSettleOfferQuorum = (offerId: string, title: string) => {
    startTransition(async () => {
      const res = await settleExpiredOfferAdmissionQuorumAction(offerId);
      if (!res.success) {
        toast.error(res.error || "Unable to settle offer admission quorum.");
        return;
      }
      toast.success(
        `Quorum evaluated for "${title}" (${"mode" in res ? res.mode : "DONE"}).`
      );
      router.refresh();
    });
  };

  const handleCancelAdmission = () => {
    if (!cancelAdmissionTarget) return;
    startTransition(async () => {
      const res = await cancelOrRefundBatchBuyAdmissionAction({
        admissionId: cancelAdmissionTarget.admissionId,
        reason: cancelReason,
        directRefundRequiredAmount: Number(directRefundAmount || 0),
        directRefundCompleted,
      });
      if (!res.success) {
        toast.error(res.error || "Unable to cancel admission.");
        return;
      }
      toast.success(
        `Admission cancelled & commission entry updated (${"commissionStatus" in res ? res.commissionStatus : "UPDATED"}).`
      );
      setCancelAdmissionTarget(null);
      setCancelReason("");
      setDirectRefundAmount("0");
      setDirectRefundCompleted(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Agreement & Counter Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-3xl border border-amber-200/80 bg-white/90 backdrop-blur-md p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Ready Vouchers</span>
            <Ticket className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-stone-900 mt-1 tabular-nums">
            {stats.activeReady}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Acceptance quorum met, awaiting center check-in
          </p>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-white/90 backdrop-blur-md p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Redeemed Enrolments</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {stats.redeemedCount}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Direct tuition collected by {instituteName}
          </p>
        </div>

        <div className="rounded-3xl border border-amber-300 bg-amber-50/70 backdrop-blur-md p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-amber-900">
            <span>Pending Student Consent</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-amber-900 mt-1 tabular-nums">
            {stats.pendingFallbackConsent}
          </div>
          <p className="text-[11px] text-amber-800/80 mt-0.5">
            Awaiting student choice on fallback shortfall
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/90 backdrop-blur-md p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Commercial Rate &amp; Role</span>
            <ShieldCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-lg font-extrabold text-stone-900 mt-1 tabular-nums">
            {agreementsSummary.activeAgreement
              ? `${agreementsSummary.activeAgreement.commissionRatePct}% Net Tuition`
              : "No Active Agreement"}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Counter role: {isIsmRole ? "ISM" : actorRole}
          </p>
        </div>
      </div>

      {/* Direct-Pay Notice + Flagged Attribution Alert */}
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IndianRupee className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            <strong>Zero-Escrow Policy:</strong> Collect all tuition &amp; refunds directly from
            students at the center counter. AcademyFind commissions apply strictly on settled
            tuition only after the 15-day cooling-off hold (+18% GST invoiced B2B).
          </span>
        </div>
        {stats.flaggedBypass > 0 && (
          <span className="rounded-full bg-amber-600 px-3 py-1 text-[11px] font-extrabold text-white">
            {stats.flaggedBypass} CRM admission(s) under Admin anti-bypass review
          </span>
        )}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
        {(
          [
            { id: "COUNTER", label: "Counter QR Verification", icon: QrCode },
            {
              id: "ENROLMENTS",
              label: `Vouchers & Quorum Settlement (${vouchers.length})`,
              icon: ClipboardCheck,
            },
            {
              id: "INVOICES",
              label: `B2B Commission & GST Invoices (${invoices.length})`,
              icon: ReceiptIndianRupee,
            },
            {
              id: "AUDIT",
              label: `Audit Log (${auditLogs.length})`,
              icon: History,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-extrabold transition-all cursor-pointer ${
                active
                  ? "bg-amber-500 text-white shadow-xs"
                  : "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: COUNTER QR / VOUCHER REDEMPTION */}
      {activeTab === "COUNTER" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 rounded-3xl border border-amber-200/80 bg-white/95 backdrop-blur-md p-6 shadow-[0_12px_36px_rgba(251,191,36,0.08)] space-y-4">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-800">
              <ScanLine className="w-4 h-4 text-amber-600" />
              <span>Step 1 · Verify Voucher Pass</span>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              Scan or paste the student&apos;s signed BatchBuy QR payload JSON or manual{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-800">
                AFBB-...
              </code>{" "}
              code to verify cryptographic integrity and locked fee before admitting.
            </p>
            <textarea
              rows={4}
              placeholder="Paste QR JSON payload or enter voucher code (e.g. AFBB-2026-XXXXXX)"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              className="w-full rounded-2xl border border-stone-200 bg-stone-50/70 px-3.5 py-3 font-mono text-xs text-stone-900 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <Button
              type="button"
              onClick={handleLookupVoucher}
              disabled={isPending || !qrInput.trim()}
              className="w-full rounded-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold h-11 cursor-pointer"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4 mr-2" />
              )}
              Verify Voucher &amp; Preview Terms
            </Button>

            {/* Quick pick active vouchers */}
            {vouchers.filter((v) => v.status === "ACTIVE").length > 0 && (
              <div className="pt-2 space-y-2 border-t border-stone-100">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Active Ready Vouchers
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {vouchers
                    .filter((v) => v.status === "ACTIVE")
                    .map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setQrInput(v.voucherCode)}
                        className="w-full flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50/60 hover:bg-amber-50/70 px-3 py-2 text-left text-xs transition-colors cursor-pointer"
                      >
                        <div>
                          <div className="font-bold text-stone-900">{v.studentName}</div>
                          <div className="font-mono text-[11px] text-amber-800">
                            {v.voucherCode} · {v.cohortCode}
                          </div>
                        </div>
                        <span className="font-extrabold text-emerald-700 tabular-nums">
                          {formatINR(v.netPayableTuition)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 rounded-3xl border border-stone-200/80 bg-white/95 backdrop-blur-md p-6 shadow-xs">
            {!preview ? (
              <div className="py-16 text-center space-y-2">
                <QrCode className="w-10 h-10 text-amber-500/70 mx-auto" />
                <h3 className="text-base font-extrabold text-stone-900">
                  Awaiting Voucher Verification
                </h3>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Verify a student&apos;s QR payload or voucher code on the left to inspect locked
                  offer terms, excluded non-tuition fields, and record direct counter payment.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-stone-200">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-extrabold text-emerald-800">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      {preview.redemptionMethod === "QR_SCAN"
                        ? "HMAC QR SIGNATURE VERIFIED"
                        : "ACTIVE VOUCHER VERIFIED"}
                    </span>
                    <h3 className="text-xl font-extrabold text-stone-900 mt-2">
                      {preview.studentName}
                    </h3>
                    <p className="text-xs text-stone-600">
                      {preview.batchName} · Cohort {preview.cohortCode} (Offer v
                      {preview.offerVersion}) · Code:{" "}
                      <span className="font-mono font-bold">{preview.voucherCode}</span>
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Locked Student Tuition
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-700">
                      {formatINR(preview.netPayableTuition)}
                    </div>
                    <div className="text-[11px] text-stone-400 line-through">
                      Listed Base Fee: {formatINR(preview.baseFee)}
                    </div>
                  </div>
                </div>

                {/* Quorum & Fallback Disclosure Warning */}
                <div
                  className={`rounded-2xl border p-4 text-xs space-y-1.5 ${
                    preview.requiresDisclosureAtCounter
                      ? "border-amber-400 bg-amber-50/90 text-amber-950"
                      : "border-emerald-200 bg-emerald-50/60 text-emerald-900"
                  }`}
                >
                  <div className="font-extrabold flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>
                      Admission Quorum Progress: {preview.currentConfirmedAdmissions} /{" "}
                      {preview.minAdmissionQuorum} confirmed (Policy: {preview.fallbackPolicy})
                    </span>
                  </div>
                  {preview.requiresDisclosureAtCounter ? (
                    <label className="flex items-start gap-2.5 pt-1 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={shortfallDisclosureAccepted}
                        onChange={(e) => setShortfallDisclosureAccepted(e.target.checked)}
                        className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                      />
                      <span>
                        Disclosed to student at counter: Initial admission records{" "}
                        <strong>{formatINR(preview.netPayableTuition)}</strong>. If final cohort
                        enrollments remain below {preview.minAdmissionQuorum} at voucher expiry,
                        any adjustment under {preview.fallbackPolicy}
                        {preview.disclosedFallbackFee != null
                          ? ` (${formatINR(preview.disclosedFallbackFee)})`
                          : ""}{" "}
                        requires explicit student consent or penalty-free cancellation.
                      </span>
                    </label>
                  ) : (
                    <p>
                      No provisional surcharge contingency applies — admission locks permanently at{" "}
                      <strong>{formatINR(preview.netPayableTuition)}</strong>.
                    </p>
                  )}
                </div>

                {/* Financial & Ledger Entry Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Upfront Direct Tuition Paid at Counter (INR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={preview.netPayableTuition}
                      value={upfrontDirectPaid}
                      onChange={(e) => setUpfrontDirectPaid(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-bold tabular-nums text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Excluded Non-Tuition Add-ons (Books/Hostel/Test Series)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={excludedNonTuitionAmount}
                      onChange={(e) => setExcludedNonTuitionAmount(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-bold tabular-nums text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Direct Payment Reference / Mode
                    </label>
                    <input
                      type="text"
                      value={paymentModeNote}
                      onChange={(e) => setPaymentModeNote(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Excluded Charges Note (Audit Proof)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Hostel deposit or study material kit"
                      value={excludedChargesNote}
                      onChange={(e) => setExcludedChargesNote(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Counter Admission Note (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Desk receipt note / batch timing"
                      value={admissionNote}
                      onChange={(e) => setAdmissionNote(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreview(null)}
                    className="rounded-full font-bold cursor-pointer"
                  >
                    Clear Preview
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmRedemption}
                    disabled={
                      isPending ||
                      (preview.requiresDisclosureAtCounter &&
                        !shortfallDisclosureAccepted)
                    }
                    className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold px-6 h-11 cursor-pointer disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    Confirm Direct Admission &amp; Redeem Voucher
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: VOUCHERS & QUORUM SETTLEMENT */}
      {activeTab === "ENROLMENTS" && (
        <div className="space-y-6">
          {/* Expired / Provisional Offer Quorum Settlement Cards */}
          {offersForQuorumSettlement.length > 0 && (
            <div className="rounded-3xl border border-amber-200/80 bg-white/95 p-5 space-y-3">
              <h3 className="text-sm font-extrabold text-stone-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Offer Admission Quorum Evaluation (Stage 2 Settlement)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {offersForQuorumSettlement.map((offer) => (
                  <div
                    key={offer.id}
                    className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 flex flex-col justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-stone-900">
                          {offer.cohortCode} · Offer v{offer.version}
                        </span>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
                          {offer.fallbackPolicy}
                        </span>
                      </div>
                      <div className="text-stone-600 mt-1">
                        {offer.batchName} — Redeemed: <strong>{offer.redeemedCount}</strong> /{" "}
                        {offer.minAdmissionQuorum} admission quorum · Provisional open:{" "}
                        <strong>{offer.provisionalOpenCount}</strong> · Pending consent:{" "}
                        <strong>{offer.pendingConsentCount}</strong>
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">
                        Voucher deadline:{" "}
                        {new Date(offer.voucherExpiresAt).toLocaleString("en-IN")}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        isPending ||
                        !offer.isVoucherWindowElapsed ||
                        offer.provisionalOpenCount === 0
                      }
                      onClick={() => handleSettleOfferQuorum(offer.id, offer.title)}
                      className="rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold h-8 cursor-pointer disabled:opacity-50"
                    >
                      {!offer.isVoucherWindowElapsed
                        ? "Voucher Window Still Open"
                        : offer.provisionalOpenCount === 0
                        ? "All Enrolments Settled"
                        : `Evaluate Quorum & Trigger Stage 2 (${offer.provisionalOpenCount})`}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Voucher & Admission Lifecycle Table */}
          <div className="rounded-3xl border border-stone-200/80 bg-white/95 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Student / Voucher</th>
                    <th className="px-4 py-3">Tuition &amp; Settlement</th>
                    <th className="px-4 py-3">Admission Ledger</th>
                    <th className="px-4 py-3">Commission Hold</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-amber-50/30">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-stone-900">{v.studentName}</div>
                        <div className="font-mono text-[11px] text-amber-800">
                          {v.voucherCode}
                        </div>
                        <div className="text-[11px] text-stone-500">
                          {v.batchName} ({v.cohortCode} · v{v.offerVersion})
                        </div>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">
                        <div className="font-bold text-stone-900">
                          Offer: {formatINR(v.netPayableTuition)}{" "}
                          <span className="text-emerald-700">({v.discountPercentage}% OFF)</span>
                        </div>
                        <div className="mt-1 inline-flex items-center rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-stone-700">
                          {v.settlementState || v.status}
                        </div>
                        {v.disclosedFallbackFee != null && (
                          <div className="text-[11px] text-amber-800 mt-0.5">
                            Fallback disclosed: {formatINR(v.disclosedFallbackFee)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">
                        {v.admission ? (
                          <div className="space-y-0.5">
                            <div className="font-bold text-stone-900">
                              Paid {formatINR(v.admission.paidAmount)} /{" "}
                              {formatINR(v.admission.totalFee)}
                            </div>
                            <div className="text-[11px] text-stone-600">
                              Status: <strong>{v.admission.status}</strong> ({v.admission.feeStatus})
                            </div>
                            {v.admission.directRefundRequiredAmount != null &&
                              v.admission.directRefundRequiredAmount > 0 && (
                                <div className="text-[11px] font-bold text-rose-700">
                                  Direct Refund: {formatINR(v.admission.directRefundRequiredAmount)}{" "}
                                  ({v.admission.directRefundStatus})
                                </div>
                              )}
                          </div>
                        ) : (
                          <span className="text-stone-400">Not redeemed yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">
                        {v.commissionEntry ? (
                          <div className="space-y-0.5">
                            <div className="font-bold text-stone-900">
                              {formatInrExact(v.commissionEntry.commissionAmount)} +{" "}
                              {formatInrExact(v.commissionEntry.gstAmount)} GST
                            </div>
                            <div className="text-[11px] text-stone-600">
                              {v.commissionEntry.status} (Hold until{" "}
                              {new Date(v.commissionEntry.holdEndsAt).toLocaleDateString("en-IN")})
                            </div>
                          </div>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {v.admission &&
                          !["CANCELLED", "REFUNDED"].includes(v.admission.status) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCancelAdmissionTarget({
                                  admissionId: v.admission!.id,
                                  studentName: v.studentName,
                                  paidAmount: v.admission!.paidAmount,
                                });
                                setDirectRefundAmount(String(v.admission!.paidAmount));
                                setCancelReason("");
                                setDirectRefundCompleted(false);
                              }}
                              className="rounded-full border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold h-8 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Cancel / Refund
                            </Button>
                          )}
                      </td>
                    </tr>
                  ))}
                  {vouchers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-stone-500">
                        No Cohort vouchers found for this institute yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: B2B COMMISSION & SEPARATE GST INVOICES */}
      {activeTab === "INVOICES" && (
        <div className="space-y-4">
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="rounded-3xl border border-stone-200/80 bg-white/95 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-600" />
                    <span className="font-mono text-sm font-extrabold text-stone-900">
                      {inv.invoiceNumber}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                      {inv.status}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    Billing Period:{" "}
                    {new Date(inv.periodStart).toLocaleDateString("en-IN")} –{" "}
                    {new Date(inv.periodEnd).toLocaleDateString("en-IN")} · {inv.entryCount} admission(s)
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-xs text-stone-500">
                    Net Commission: <strong>{formatInrExact(inv.subtotalCommission)}</strong> + GST:{" "}
                    <strong>{formatInrExact(inv.gstTotalAmount)}</strong>
                  </div>
                  <div className="text-lg font-extrabold text-stone-900">
                    Total Payable: {formatInrExact(inv.totalPayableAmount)}
                  </div>
                  {inv.appliedCreditAmount > 0 && (
                    <div className="text-[11px] font-semibold text-amber-800">
                      Credit Notes Applied: −{formatInrExact(inv.appliedCreditAmount)} · Net Collectible:{" "}
                      {formatInrExact(inv.effectiveCollectibleBalance)}
                    </div>
                  )}
                  <div className="text-[11px] font-semibold text-emerald-700">
                    Paid: {formatInrExact(inv.amountPaid)} · Balance:{" "}
                    {formatInrExact(
                      Math.max(0, inv.effectiveCollectibleBalance - inv.amountPaid)
                    )}
                  </div>
                </div>
              </div>

              {inv.sacValidationDisclaimer && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-950 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>{inv.sacValidationDisclaimer}</span>
                </div>
              )}

              {inv.payments.length > 0 && (
                <div className="pt-2 border-t border-stone-100 space-y-1 text-xs">
                  <div className="font-bold text-stone-600">Recorded B2B Settlements:</div>
                  {inv.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap justify-between text-stone-700 tabular-nums"
                    >
                      <span>
                        {p.paymentMode} · UTR/Ref:{" "}
                        <strong className="font-mono">{p.utrOrReference}</strong>
                      </span>
                      <span className="font-bold text-emerald-700">
                        {formatInrExact(p.amount)} ({new Date(p.paidAt).toLocaleDateString("en-IN")})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {invoices.length === 0 && (
            <div className="rounded-3xl border border-stone-200 bg-white/90 p-10 text-center text-xs text-stone-500">
              No B2B commission invoices generated yet. Matured commission entries appear here once
              the 15-day commercial cooling-off period clears.
            </div>
          )}

          {creditNotes.length > 0 && (
            <div className="rounded-3xl border border-amber-200/80 bg-white/95 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-stone-900 flex items-center gap-2">
                  <ReceiptIndianRupee className="w-4 h-4 text-amber-600" />
                  <span>GST Commission Credit Notes ({creditNotes.length})</span>
                </h4>
                <span className="text-[11px] font-semibold text-stone-500">
                  Original issued invoices remain immutable per GST audit rules
                </span>
              </div>
              <div className="space-y-2">
                {creditNotes.map((cn) => (
                  <div
                    key={cn.id}
                    className="rounded-2xl border border-stone-200/80 bg-amber-50/30 p-3.5 text-xs flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold text-stone-900">
                          {cn.creditNoteNumber}
                        </span>
                        <span className="text-stone-500">
                          against{" "}
                          <strong className="font-mono text-stone-700">{cn.invoiceNumber}</strong>
                        </span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                          {cn.status}
                        </span>
                      </div>
                      <div className="text-stone-600 mt-1">
                        {cn.reasonType} — {cn.reason}
                      </div>
                      {cn.settledRefundUtr && (
                        <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                          Refund Settled · UTR: <span className="font-mono">{cn.settledRefundUtr}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="font-extrabold text-stone-900">
                        Total Credit: {formatInrExact(cn.totalCreditAmount)}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        Comm: {formatInrExact(cn.commissionReversalAmount)} + GST:{" "}
                        {formatInrExact(cn.gstReversalTotal)}
                      </div>
                      <div className="text-[11px] font-semibold text-amber-800">
                        Applied to Balance: {formatInrExact(cn.appliedToInvoiceBalance)} · Refundable:{" "}
                        {formatInrExact(cn.refundPayableToInstitute)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: AUDIT LOGS */}
      {activeTab === "AUDIT" && (
        <div className="rounded-3xl border border-stone-200/80 bg-white/95 divide-y divide-stone-100">
          {auditLogs.map((log) => (
            <div key={log.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
              <div>
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-stone-800">
                  {log.action}
                </span>{" "}
                <span className="font-bold text-stone-900">{log.entityType}</span>{" "}
                <span className="text-stone-500 font-mono">({log.entityId})</span>
                <div className="text-stone-600 mt-1">
                  Actor: <strong>{log.actorName}</strong> ({log.actorRole})
                  {log.reason ? ` — ${log.reason}` : ""}
                </div>
              </div>
              <div className="text-[11px] text-stone-400">
                {new Date(log.createdAt).toLocaleString("en-IN")}
              </div>
            </div>
          ))}
          {auditLogs.length === 0 && (
            <div className="p-10 text-center text-xs text-stone-500">
              No BatchBuy audit entries recorded yet.
            </div>
          )}
        </div>
      )}

      {/* CANCEL / REFUND MODAL */}
      {cancelAdmissionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-stone-900">
                Cancel / Refund BatchBuy Admission
              </h3>
              <button
                type="button"
                onClick={() => setCancelAdmissionTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-stone-600">
              Student: <strong>{cancelAdmissionTarget.studentName}</strong> · Paid directly at
              center: <strong>{formatINR(cancelAdmissionTarget.paidAmount)}</strong>. Cancellations
              within the 15-day cooling-off hold void AcademyFind commission automatically.
            </p>
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">
                Cancellation / Withdrawal Reason
              </label>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation or student withdrawal..."
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">
                Direct Student Refund Amount (INR)
              </label>
              <input
                type="number"
                min={0}
                value={directRefundAmount}
                onChange={(e) => setDirectRefundAmount(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold tabular-nums text-stone-900 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={directRefundCompleted}
                onChange={(e) => setDirectRefundCompleted(e.target.checked)}
                className="rounded border-stone-300 text-amber-600"
              />
              <span>Institute has already refunded student directly</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelAdmissionTarget(null)}
                className="rounded-full text-xs font-bold cursor-pointer"
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={isPending || cancelReason.trim().length < 5}
                onClick={handleCancelAdmission}
                className="rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Confirm Cancellation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
