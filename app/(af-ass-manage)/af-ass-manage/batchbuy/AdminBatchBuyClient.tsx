"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileSignature,
  FileText,
  History,
  IndianRupee,
  Loader2,
  ReceiptIndianRupee,
  Scale,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { saveInstituteBatchBuyAgreementAction } from "@/lib/batchbuy/agreementActions";
import {
  generateCommissionInvoiceAction,
  issueCommissionInvoiceAction,
  matureEligibleCommissionsAction,
  recordCommissionPaymentAction,
  reviewFlaggedAttributionAction,
  settleCreditNoteRefundAction,
} from "@/lib/batchbuy/commissionActions";
import type {
  BatchBuyAuditEntryDTO,
  BatchBuyCreditNoteDTO,
  CommissionInvoiceDTO,
  FlaggedAttributionDTO,
} from "@/lib/batchbuy/redemptionQueries";
import type {
  BatchBuyRateTierType,
  TaxTreatmentModeType,
} from "@/lib/batchbuy/commissionMath";
import { Button } from "@/components/ui/button";

function formatInrExact(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface AdminBatchBuyClientProps {
  institutes: {
    id: string;
    name: string;
    city: string | null;
    subscriptionPlan: string;
  }[];
  agreements: {
    id: string;
    instituteId: string;
    instituteName: string;
    instituteCity: string | null;
    version: number;
    rateTier: string;
    commissionRatePct: number;
    status: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    attributionWindowDays: number;
    holdingPeriodDays: number;
    sacCode: string | null;
    sacValidatedByCa: boolean;
    caValidatorName?: string | null;
    caMembershipNumber?: string | null;
    caValidationNote?: string | null;
    gstRatePct: number;
    gstTreatmentNote: string | null;
    acceptedRepresentativeName: string | null;
    acceptedDesignation: string | null;
    acceptedAt: string | null;
  }[];
  attributions: FlaggedAttributionDTO[];
  ledgerEntries: {
    id: string;
    instituteId: string;
    instituteName: string;
    admissionId: string;
    studentName: string;
    admissionStatus: string;
    voucherCode: string | null;
    invoiceId: string | null;
    status: string;
    commissionableTuition: number;
    excludedNonTuitionAmount: number;
    commissionRatePct: number;
    commissionAmount: number;
    gstRatePct: number;
    gstAmount: number;
    totalPayableAmount: number;
    redeemedAt: string;
    holdEndsAt: string;
    isHoldElapsed: boolean;
    maturedAt: string | null;
    voidReason: string | null;
  }[];
  invoices: CommissionInvoiceDTO[];
  creditNotes: BatchBuyCreditNoteDTO[];
  auditLogs: BatchBuyAuditEntryDTO[];
}

export function AdminBatchBuyClient({
  institutes,
  agreements,
  attributions,
  ledgerEntries,
  invoices,
  creditNotes,
  auditLogs,
}: AdminBatchBuyClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<
    "AGREEMENTS" | "BYPASS" | "INVOICING" | "AUDIT"
  >("AGREEMENTS");

  // Agreement Form State
  const [agInstituteId, setAgInstituteId] = useState(institutes[0]?.id ?? "");
  const [agRateTier, setAgRateTier] = useState<BatchBuyRateTierType>("STANDARD_3_PCT");
  const [agAttributionDays, setAgAttributionDays] = useState("30");
  const [agHoldingDays, setAgHoldingDays] = useState("15");
  const [agSacCode, setAgSacCode] = useState("");
  const [agSacValidatedByCa, setAgSacValidatedByCa] = useState(false);
  const [agCaValidatorName, setAgCaValidatorName] = useState("");
  const [agCaMembershipNumber, setAgCaMembershipNumber] = useState("");
  const [agCaValidationNote, setAgCaValidationNote] = useState("");
  const [agEffectiveFrom, setAgEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [agActivateImmediately, setAgActivateImmediately] = useState(false);
  const [agRepName, setAgRepName] = useState("");
  const [agRepDesignation, setAgRepDesignation] = useState("");
  const [agGstNote, setAgGstNote] = useState(
    "Commission applies strictly on settled tuition base. 18% GST billed separately pending final CA SAC confirmation."
  );
  const [agClawbackNote, setAgClawbackNote] = useState(
    "15-day commercial cooling-off hold from admission date; cancellations inside hold void commission cleanly."
  );

  // Bypass Review Notes Map
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  // Invoice Generator Form State
  const [invInstituteId, setInvInstituteId] = useState(institutes[0]?.id ?? "");
  const [invPeriodStart, setInvPeriodStart] = useState(
    new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)
  );
  const [invPeriodEnd, setInvPeriodEnd] = useState(
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  );
  const [invTaxMode, setInvTaxMode] = useState<TaxTreatmentModeType>(
    "PENDING_CA_VALIDATION"
  );
  const [invInstituteGstin, setInvInstituteGstin] = useState("");
  const [invIssueImmediately, setInvIssueImmediately] = useState(false);

  // Payment Recorder Modal
  const [paymentTarget, setPaymentTarget] = useState<CommissionInvoiceDTO | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<
    "NEFT" | "RTGS" | "IMPS" | "UPI_B2B" | "RAZORPAY_B2B_LINK" | "CHEQUE"
  >("NEFT");
  const [payUtr, setPayUtr] = useState("");
  const [payNote, setPayNote] = useState("");

  // Credit Note Refund Settlement Modal
  const [refundTarget, setRefundTarget] = useState<BatchBuyCreditNoteDTO | null>(null);
  const [refundUtr, setRefundUtr] = useState("");

  const kpis = useMemo(() => {
    const flaggedPending = attributions.filter(
      (a) => a.matchStatus === "FLAGGED_SUSPECTED_BYPASS"
    ).length;
    const holdCount = ledgerEntries.filter((e) => e.status === "HOLD_PERIOD").length;
    const eligibleNet = ledgerEntries
      .filter((e) => e.status === "ELIGIBLE")
      .reduce((acc, e) => acc + e.commissionAmount, 0);
    const outstandingTotal = invoices
      .filter((i) => ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status))
      .reduce(
        (acc, i) => acc + Math.max(0, i.effectiveCollectibleBalance - i.amountPaid),
        0
      );
    return { flaggedPending, holdCount, eligibleNet, outstandingTotal };
  }, [attributions, ledgerEntries, invoices]);

  const handleSaveAgreement = () => {
    if (!agInstituteId) {
      toast.error("Select an institute.");
      return;
    }
    startTransition(async () => {
      const res = await saveInstituteBatchBuyAgreementAction({
        instituteId: agInstituteId,
        rateTier: agRateTier,
        gstRatePct: 18,
        gstTreatmentNote: agGstNote,
        sacCode: agSacCode.trim() || null,
        sacValidatedByCa: agSacValidatedByCa,
        caValidatorName: agSacValidatedByCa ? agCaValidatorName.trim() || null : null,
        caMembershipNumber: agSacValidatedByCa ? agCaMembershipNumber.trim() || null : null,
        caValidationNote: agSacValidatedByCa ? agCaValidationNote.trim() || null : null,
        attributionWindowDays: Number(agAttributionDays || 30),
        holdingPeriodDays: Number(agHoldingDays || 15),
        paymentDueDays: 15,
        cancellationClawbackPolicy: agClawbackNote,
        effectiveFrom: new Date(agEffectiveFrom).toISOString(),
        effectiveTo: null,
        activateImmediately: agActivateImmediately,
        acceptedRepresentativeName: agRepName.trim() || null,
        acceptedDesignation: agRepDesignation.trim() || null,
      });
      if (!res.success || !("version" in res)) {
        toast.error(
          ("error" in res ? res.error : null) || "Unable to create agreement."
        );
        return;
      }
      toast.success(`Agreement v${res.version} created (${res.status}).`);
      router.refresh();
    });
  };

  const handleReviewAttribution = (
    attributionId: string,
    decision: "CONFIRMED_BYPASS" | "DISMISSED_FALSE_POSITIVE"
  ) => {
    const reviewNote = (reviewNotes[attributionId] || "").trim();
    if (reviewNote.length < 5) {
      toast.error("Provide at least 5 characters explaining your adjudication decision.");
      return;
    }
    startTransition(async () => {
      const res = await reviewFlaggedAttributionAction({
        attributionId,
        decision,
        reviewNote,
      });
      if (!res.success || !("matchStatus" in res)) {
        toast.error(("error" in res ? res.error : null) || "Adjudication failed.");
        return;
      }
      toast.success(`Attribution marked ${res.matchStatus}.`);
      router.refresh();
    });
  };

  const handleMatureCommissions = () => {
    startTransition(async () => {
      const res = await matureEligibleCommissionsAction();
      if (!res.success || !("maturedCount" in res)) {
        toast.error(
          ("error" in res ? res.error : null) || "Unable to mature entries."
        );
        return;
      }
      toast.success(`Matured ${res.maturedCount} ledger entry(ies) past 15-day hold.`);
      router.refresh();
    });
  };

  const handleGenerateInvoice = () => {
    if (!invInstituteId) return;
    startTransition(async () => {
      const res = await generateCommissionInvoiceAction({
        instituteId: invInstituteId,
        periodStart: new Date(invPeriodStart).toISOString(),
        periodEnd: new Date(invPeriodEnd).toISOString(),
        taxTreatmentMode: invTaxMode,
        instituteGstin: invInstituteGstin.trim() || null,
        issueImmediately: invIssueImmediately,
      });
      if (!res.success || !("invoiceNumber" in res)) {
        toast.error(
          ("error" in res ? res.error : null) || "Invoice generation failed."
        );
        return;
      }
      toast.success(
        `Generated invoice ${res.invoiceNumber} (${formatInrExact(
          res.totalPayableAmount
        )}).`
      );
      router.refresh();
    });
  };

  const handleIssueInvoice = (invoiceId: string) => {
    startTransition(async () => {
      const res = await issueCommissionInvoiceAction(invoiceId);
      if (!res.success) {
        toast.error(("error" in res ? res.error : null) || "Unable to issue invoice.");
        return;
      }
      toast.success("Invoice marked ISSUED.");
      router.refresh();
    });
  };

  const handleSettleCreditNoteRefund = () => {
    if (!refundTarget) return;
    startTransition(async () => {
      const res = await settleCreditNoteRefundAction({
        creditNoteId: refundTarget.id,
        utrOrReference: refundUtr.trim(),
      });
      if (!res.success) {
        toast.error(
          ("error" in res ? res.error : null) || "Failed to settle credit note refund."
        );
        return;
      }
      toast.success(`Refund settled for credit note ${refundTarget.creditNoteNumber}.`);
      setRefundTarget(null);
      setRefundUtr("");
      router.refresh();
    });
  };

  const handleRecordPayment = () => {
    if (!paymentTarget) return;
    startTransition(async () => {
      const res = await recordCommissionPaymentAction({
        invoiceId: paymentTarget.id,
        amount: Number(payAmount || 0),
        paymentMode: payMode,
        utrOrReference: payUtr.trim(),
        note: payNote.trim() || null,
      });
      if (!res.success || !("status" in res)) {
        toast.error(
          ("error" in res ? res.error : null) || "Payment recording failed."
        );
        return;
      }
      toast.success(`Payment recorded — invoice is now ${res.status}.`);
      setPaymentTarget(null);
      setPayUtr("");
      setPayNote("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-3xl border border-amber-200 bg-white/95 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Active Agreements</span>
            <FileSignature className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-stone-900 mt-1 tabular-nums">
            {agreements.filter((a) => a.status === "ACTIVE").length}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Required before an institute can publish offers
          </p>
        </div>

        <div className="rounded-3xl border border-amber-300 bg-amber-50/70 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-amber-900">
            <span>Flagged Suspected Bypass</span>
            <ShieldAlert className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-2xl font-extrabold text-amber-950 mt-1 tabular-nums">
            {kpis.flaggedPending}
          </div>
          <p className="text-[11px] text-amber-800/80 mt-0.5">
            Pending human Admin review before billing
          </p>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-white/95 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Unbilled Eligible Net Comm.</span>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {formatInrExact(kpis.eligibleNet)}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            {kpis.holdCount} entry(ies) currently inside 15d cooling-off
          </p>
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white/95 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-stone-500">
            <span>Issued B2B Receivable</span>
            <ReceiptIndianRupee className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-stone-900 mt-1 tabular-nums">
            {formatInrExact(kpis.outstandingTotal)}
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Includes separate 18% GST liability
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
        {(
          [
            {
              id: "AGREEMENTS",
              label: `Agreements (2%/3%/4%) · ${agreements.length}`,
              icon: FileSignature,
            },
            {
              id: "BYPASS",
              label: `Anti-Bypass Queue (${kpis.flaggedPending} pending)`,
              icon: Scale,
            },
            {
              id: "INVOICING",
              label: `15d Holds & GST Invoices (${invoices.length})`,
              icon: ReceiptIndianRupee,
            },
            {
              id: "AUDIT",
              label: `Audit Trail (${auditLogs.length})`,
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

      {/* TAB 1: COMMERCIAL AGREEMENTS */}
      {activeTab === "AGREEMENTS" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-5 rounded-3xl border border-amber-200/80 bg-white/95 p-6 space-y-4">
            <h3 className="text-base font-extrabold text-stone-900 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-amber-600" />
              <span>Draft or Activate Commercial Agreement</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Institute</label>
                <select
                  value={agInstituteId}
                  onChange={(e) => setAgInstituteId(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-900"
                >
                  {institutes.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} {inst.city ? `(${inst.city})` : ""} · {inst.subscriptionPlan}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Commission Rate Tier (Net Tuition Only)
                </label>
                <select
                  value={agRateTier}
                  onChange={(e) => setAgRateTier(e.target.value as BatchBuyRateTierType)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 font-bold text-stone-900"
                >
                  <option value="PARTNER_2_PCT">2.00% — Partner Institute</option>
                  <option value="STANDARD_3_PCT">3.00% — Standard Pilot Rate</option>
                  <option value="NON_PARTNER_4_PCT">4.00% — Non-Partner Conversion</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Attrib (Days)</label>
                  <input
                    type="number"
                    min={7}
                    max={90}
                    value={agAttributionDays}
                    onChange={(e) => setAgAttributionDays(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Hold (Days)</label>
                  <input
                    type="number"
                    min={15}
                    max={45}
                    value={agHoldingDays}
                    onChange={(e) => setAgHoldingDays(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">SAC Code</label>
                  <input
                    type="text"
                    placeholder="CA-validated 6-digit SAC"
                    value={agSacCode}
                    onChange={(e) => setAgSacCode(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Effective From</label>
                <input
                  type="date"
                  value={agEffectiveFrom}
                  onChange={(e) => setAgEffectiveFrom(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agSacValidatedByCa}
                  onChange={(e) => setAgSacValidatedByCa(e.target.checked)}
                />
                <span>CA formally signed off on SAC &amp; GST classification</span>
              </label>

              {agSacValidatedByCa && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="CA Full Name *"
                      value={agCaValidatorName}
                      onChange={(e) => setAgCaValidatorName(e.target.value)}
                      className="rounded-xl border border-stone-200 bg-white px-3 py-2"
                    />
                    <input
                      type="text"
                      placeholder="ICAI Membership No. (6 digits) *"
                      value={agCaMembershipNumber}
                      onChange={(e) => setAgCaMembershipNumber(e.target.value)}
                      className="rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="CA Sign-off Note (optional)"
                    value={agCaValidationNote}
                    onChange={(e) => setAgCaValidationNote(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={agActivateImmediately}
                  onChange={(e) => setAgActivateImmediately(e.target.checked)}
                />
                <span>Activate immediately (requires institute signatory on file)</span>
              </label>

              {agActivateImmediately && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Rep Full Name"
                    value={agRepName}
                    onChange={(e) => setAgRepName(e.target.value)}
                    className="rounded-xl border border-stone-200 px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder="Designation"
                    value={agRepDesignation}
                    onChange={(e) => setAgRepDesignation(e.target.value)}
                    className="rounded-xl border border-stone-200 px-3 py-2"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-stone-700 mb-1">GST &amp; Tax Note</label>
                <textarea
                  rows={2}
                  value={agGstNote}
                  onChange={(e) => setAgGstNote(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  15-Day Commercial Cooling-Off &amp; Clawback Policy
                </label>
                <textarea
                  rows={2}
                  value={agClawbackNote}
                  onChange={(e) => setAgClawbackNote(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>

              <Button
                type="button"
                disabled={isPending}
                onClick={handleSaveAgreement}
                className="w-full rounded-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold h-10 cursor-pointer"
              >
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create Versioned Agreement
              </Button>
            </div>
          </div>

          <div className="xl:col-span-7 space-y-3">
            {agreements.map((ag) => (
              <div
                key={ag.id}
                className="rounded-3xl border border-stone-200 bg-white/95 p-5 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-extrabold text-sm text-stone-900">
                      {ag.instituteName}
                    </span>{" "}
                    <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-bold text-stone-700">
                      v{ag.version} · {ag.commissionRatePct}% Net Tuition
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-extrabold ${
                      ag.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-800"
                        : ag.status === "DRAFT"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {ag.status}
                  </span>
                </div>
                <div className="text-stone-600">
                  Hold: <strong>{ag.holdingPeriodDays}d</strong> · Attribution Window:{" "}
                  <strong>{ag.attributionWindowDays}d</strong> · GST:{" "}
                  <strong>+{ag.gstRatePct}% separate</strong> · SAC:{" "}
                  <strong className="font-mono">{ag.sacCode || "Pending"}</strong>{" "}
                  {ag.sacValidatedByCa ? "(CA Signed Off)" : "(Pending CA Validation)"}
                </div>
                {ag.acceptedRepresentativeName && (
                  <div className="text-emerald-800 font-semibold">
                    Signed by {ag.acceptedRepresentativeName} ({ag.acceptedDesignation}) on{" "}
                    {ag.acceptedAt
                      ? new Date(ag.acceptedAt).toLocaleDateString("en-IN")
                      : "N/A"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: ANTI-BYPASS ADJUDICATION */}
      {activeTab === "BYPASS" && (
        <div className="space-y-4">
          {attributions.map((attr) => (
            <div
              key={attr.id}
              className="rounded-3xl border border-stone-200 bg-white/95 p-5 space-y-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-extrabold text-stone-900">
                    {attr.studentName}
                  </span>{" "}
                  · <span className="font-semibold text-stone-700">{attr.instituteName}</span> ·{" "}
                  <span>Fee: {formatInrExact(attr.admissionTotalFee)}</span>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] font-extrabold ${
                    attr.matchStatus === "FLAGGED_SUSPECTED_BYPASS"
                      ? "bg-amber-100 text-amber-900"
                      : attr.matchStatus === "CONFIRMED_BYPASS"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {attr.matchStatus}
                </span>
              </div>

              {attr.evidenceJson && (
                <pre className="rounded-2xl bg-stone-50 border border-stone-200 p-3 font-mono text-[11px] text-stone-700 overflow-x-auto">
                  {JSON.stringify(attr.evidenceJson, null, 2)}
                </pre>
              )}

              {attr.matchStatus === "FLAGGED_SUSPECTED_BYPASS" ? (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Admin verification note (e.g., confirmed same student joined batch via BatchBuy funnel)..."
                    value={reviewNotes[attr.id] || ""}
                    onChange={(e) =>
                      setReviewNotes((prev) => ({ ...prev, [attr.id]: e.target.value }))
                    }
                    className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleReviewAttribution(attr.id, "CONFIRMED_BYPASS")}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer h-9 px-4"
                  >
                    Confirm Attribution
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      handleReviewAttribution(attr.id, "DISMISSED_FALSE_POSITIVE")
                    }
                    className="rounded-full border-stone-300 font-bold cursor-pointer h-9 px-4"
                  >
                    Dismiss False Positive
                  </Button>
                </div>
              ) : (
                <div className="text-stone-600">
                  Reviewed:{" "}
                  {attr.reviewedAt
                    ? new Date(attr.reviewedAt).toLocaleString("en-IN")
                    : "—"}{" "}
                  · Note: {attr.reviewNote}
                </div>
              )}
            </div>
          ))}
          {attributions.length === 0 && (
            <div className="rounded-3xl border border-stone-200 bg-white/95 p-10 text-center text-xs text-stone-500">
              No CRM bypass flags to adjudicate right now.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: 15-DAY COOLING-OFF & GST B2B INVOICING */}
      {activeTab === "INVOICING" && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-amber-200/80 bg-white/95 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-stone-900">
                  Mature 15-Day Holds &amp; Generate Segregated GST Commission Invoice
                </h3>
                <p className="text-xs text-stone-600">
                  Only settled admissions that cleared the 15-day commercial cooling-off hold are
                  eligible for billing. Net commission and 18% GST are always itemized separately.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={handleMatureCommissions}
                className="rounded-full border-amber-300 text-amber-900 hover:bg-amber-50 font-bold text-xs cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 mr-1.5" />
                Run 15-Day Hold Maturation Batch
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs items-end">
              <div className="lg:col-span-2">
                <label className="block font-bold text-stone-700 mb-1">Institute</label>
                <select
                  value={invInstituteId}
                  onChange={(e) => setInvInstituteId(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2"
                >
                  {institutes.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">Period Start</label>
                <input
                  type="date"
                  value={invPeriodStart}
                  onChange={(e) => setInvPeriodStart(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">Period End</label>
                <input
                  type="date"
                  value={invPeriodEnd}
                  onChange={(e) => setInvPeriodEnd(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">GST Mode</label>
                <select
                  value={invTaxMode}
                  onChange={(e) => {
                    const next = e.target.value as TaxTreatmentModeType;
                    setInvTaxMode(next);
                    if (next === "PENDING_CA_VALIDATION") {
                      setInvIssueImmediately(false);
                    }
                  }}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2"
                >
                  <option value="PENDING_CA_VALIDATION">Pending CA Validation</option>
                  <option value="INTRA_STATE_CGST_SGST">Intra-State CGST+SGST</option>
                  <option value="INTER_STATE_IGST">Inter-State IGST</option>
                </select>
              </div>
              <div>
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={handleGenerateInvoice}
                  className="w-full rounded-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs h-9 cursor-pointer"
                >
                  Generate Invoice
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-xs items-center">
              <input
                type="text"
                placeholder="Institute GSTIN (optional)"
                value={invInstituteGstin}
                onChange={(e) => setInvInstituteGstin(e.target.value)}
                className="rounded-xl border border-stone-200 px-3 py-1.5 w-60 font-mono"
              />
              <label
                className={`flex items-center gap-2 ${
                  invTaxMode === "PENDING_CA_VALIDATION"
                    ? "cursor-not-allowed text-stone-400"
                    : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={invTaxMode === "PENDING_CA_VALIDATION"}
                  checked={invIssueImmediately}
                  onChange={(e) => setInvIssueImmediately(e.target.checked)}
                />
                <span>Issue immediately upon creation</span>
              </label>
              {invTaxMode === "PENDING_CA_VALIDATION" && (
                <span className="text-[11px] font-semibold text-amber-800">
                  Only DRAFT invoices are allowed until a CA validates SAC &amp; tax mode.
                </span>
              )}
            </div>
          </div>

          {/* Invoices List */}
          <div className="space-y-3">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="rounded-3xl border border-stone-200 bg-white/95 p-5 space-y-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-stone-900">
                        {inv.invoiceNumber}
                      </span>
                      <span className="font-bold text-stone-700">· {inv.instituteName}</span>
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                        {inv.status}
                      </span>
                    </div>
                    <div className="text-stone-500 mt-0.5">
                      {inv.entryCount} entry(ies) · Mode: {inv.taxTreatmentMode} · SAC:{" "}
                      {inv.sacCodeUsed || "Unassigned"}
                    </div>
                  </div>
                  <div className="text-right tabular-nums space-y-1">
                    <div>
                      Net Revenue: <strong>{formatInrExact(inv.subtotalCommission)}</strong> + GST:{" "}
                      <strong>{formatInrExact(inv.gstTotalAmount)}</strong> ={" "}
                      <strong className="text-sm text-stone-900">
                        {formatInrExact(inv.totalPayableAmount)}
                      </strong>
                    </div>
                    {inv.appliedCreditAmount > 0 && (
                      <div className="text-[11px] font-semibold text-amber-800">
                        Applied Credit Notes: −{formatInrExact(inv.appliedCreditAmount)} · Net Collectible:{" "}
                        {formatInrExact(inv.effectiveCollectibleBalance)}
                      </div>
                    )}
                    <div className="text-emerald-700 font-bold">
                      Paid: {formatInrExact(inv.amountPaid)} · Remaining:{" "}
                      {formatInrExact(
                        Math.max(0, inv.effectiveCollectibleBalance - inv.amountPaid)
                      )}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      {inv.status === "DRAFT" && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleIssueInvoice(inv.id)}
                          className="rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold h-7 cursor-pointer"
                        >
                          Issue Invoice
                        </Button>
                      )}
                      {!["VOID", "PAID"].includes(inv.status) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPaymentTarget(inv);
                            setPayAmount(
                              String(
                                Math.max(
                                  0,
                                  inv.effectiveCollectibleBalance - inv.amountPaid
                                ).toFixed(2)
                              )
                            );
                            setPayUtr("");
                            setPayNote("");
                          }}
                          className="rounded-full border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs font-bold h-7 cursor-pointer"
                        >
                          Record UTR Payment
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                {inv.sacValidationDisclaimer && (
                  <div className="rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-[11px] text-amber-950">
                    {inv.sacValidationDisclaimer}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Credit Notes & Refund Liability */}
          <div className="rounded-3xl border border-amber-200/80 bg-white/95 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-stone-900 flex items-center gap-2">
                <ReceiptIndianRupee className="w-4 h-4 text-amber-600" />
                <span>B2B Credit Notes &amp; Refund Liability ({creditNotes.length})</span>
              </h3>
              <span className="text-[11px] font-semibold text-stone-500">
                Issued invoices &amp; settled payments remain immutable; reversals emit GST credit notes
              </span>
            </div>
            {creditNotes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-200 p-6 text-center text-xs text-stone-500">
                No GST credit notes issued yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {creditNotes.map((cn) => (
                  <div
                    key={cn.id}
                    className="rounded-2xl border border-stone-200/80 bg-amber-50/30 p-4 text-xs flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-extrabold text-stone-900">
                          {cn.creditNoteNumber}
                        </span>
                        <span className="text-stone-700 font-bold">
                          · {cn.instituteName ?? cn.instituteIdSnapshot}
                        </span>
                        <span className="text-stone-500">
                          against{" "}
                          <strong className="font-mono text-stone-700">{cn.invoiceNumber}</strong>
                        </span>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                          {cn.status}
                        </span>
                      </div>
                      <div className="text-stone-600">
                        {cn.reasonType} — {cn.reason}
                      </div>
                      {cn.settledRefundUtr && (
                        <div className="text-[11px] font-semibold text-emerald-700">
                          Refund Settled · UTR:{" "}
                          <span className="font-mono">{cn.settledRefundUtr}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right tabular-nums space-y-1">
                      <div className="font-extrabold text-stone-900">
                        Total Credit: {formatInrExact(cn.totalCreditAmount)}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        Comm: {formatInrExact(cn.commissionReversalAmount)} + GST:{" "}
                        {formatInrExact(cn.gstReversalTotal)}
                      </div>
                      <div className="text-[11px] font-semibold text-amber-900">
                        Applied to Invoice: {formatInrExact(cn.appliedToInvoiceBalance)} · Refundable:{" "}
                        {formatInrExact(cn.refundPayableToInstitute)}
                      </div>
                      {cn.status === "REFUND_PENDING" && cn.refundPayableToInstitute > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRefundTarget(cn);
                            setRefundUtr("");
                          }}
                          className="rounded-full border-amber-300 text-amber-900 hover:bg-amber-50 text-xs font-bold h-7 cursor-pointer"
                        >
                          Settle Refund UTR
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT TRAIL */}
      {activeTab === "AUDIT" && (
        <div className="rounded-3xl border border-stone-200 bg-white/95 divide-y divide-stone-100">
          {auditLogs.map((log) => (
            <div key={log.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
              <div>
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-mono text-[10px] font-extrabold text-stone-800">
                  {log.action}
                </span>{" "}
                <span className="font-bold text-stone-900">{log.entityType}</span> ·{" "}
                <span className="font-mono text-stone-500">{log.entityId}</span>
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
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {paymentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-stone-900">
                Record B2B Commission Payment
              </h3>
              <button
                type="button"
                onClick={() => setPaymentTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="text-stone-600">
              Invoice <strong className="font-mono">{paymentTarget.invoiceNumber}</strong> (
              {paymentTarget.instituteName})
            </p>
            <div className="space-y-2.5">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Amount Received (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">Payment Mode</label>
                <select
                  value={payMode}
                  onChange={(e) =>
                    setPayMode(
                      e.target.value as
                        | "NEFT"
                        | "RTGS"
                        | "IMPS"
                        | "UPI_B2B"
                        | "RAZORPAY_B2B_LINK"
                        | "CHEQUE"
                    )
                  }
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2"
                >
                  <option value="NEFT">NEFT</option>
                  <option value="RTGS">RTGS</option>
                  <option value="IMPS">IMPS</option>
                  <option value="UPI_B2B">UPI B2B</option>
                  <option value="RAZORPAY_B2B_LINK">Razorpay B2B Link</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Unique UTR / Bank Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g., UTR20261111998811"
                  value={payUtr}
                  onChange={(e) => setPayUtr(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 mb-1">Note</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaymentTarget(null)}
                className="rounded-full font-bold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isPending || payUtr.trim().length < 4}
                onClick={handleRecordPayment}
                className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Save Payment Record
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* CREDIT NOTE REFUND MODAL */}
      {refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-stone-900">
                Settle Credit Note Refund
              </h3>
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="text-stone-600">
              Credit Note <strong className="font-mono">{refundTarget.creditNoteNumber}</strong>{" "}
              ({refundTarget.instituteName ?? refundTarget.instituteIdSnapshot}) — Refundable:{" "}
              <strong className="tabular-nums text-stone-900">
                {formatInrExact(refundTarget.refundPayableToInstitute)}
              </strong>
            </p>
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                Unique Refund Bank UTR / Reference
              </label>
              <input
                type="text"
                placeholder="e.g., UTRREFUND2026111201"
                value={refundUtr}
                onChange={(e) => setRefundUtr(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 font-mono"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRefundTarget(null)}
                className="rounded-full font-bold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isPending || refundUtr.trim().length < 4}
                onClick={handleSettleCreditNoteRefund}
                className="rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold cursor-pointer"
              >
                {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Mark Refund Settled
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
