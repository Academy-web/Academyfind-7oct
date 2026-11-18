"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  Lock,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import type { ManagerCohortOfferItem } from "@/lib/batchbuy/offerQueries";
import type { SerializedCohortOfferSummary } from "@/lib/batchbuy/offerValidation";
import { computeOfferFeeBreakdown } from "@/lib/batchbuy/offerValidation";
import type { SlabFallbackPolicyType } from "@/lib/batchbuy/slabValidation";
import {
  publishDraftCohortOfferAction,
  saveCohortOfferAction,
  withdrawCohortOfferAction,
} from "@/lib/batchbuy/offerActions";
import {
  acceptAndActivateAgreementAction,
  type getInstituteAgreementsSummary,
} from "@/lib/batchbuy/agreementActions";
import { getFallbackPolicyMeta } from "@/components/batchbuy/fallbackPolicyInfo";
import { Button } from "@/components/ui/button";

type AgreementsSummaryDTO = Awaited<ReturnType<typeof getInstituteAgreementsSummary>>;

interface BatchBuyOffersManagerProps {
  instituteId: string;
  instituteName: string;
  cohorts: ManagerCohortOfferItem[];
  agreementsSummary?: AgreementsSummaryDTO;
}

function toDatetimeLocalValue(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function defaultDates() {
  const offerExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const voucherExpiry = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  return {
    offerExpiresAt: toDatetimeLocalValue(offerExpiry),
    voucherExpiresAt: toDatetimeLocalValue(voucherExpiry),
  };
}

function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function offerStatusPill(status: string) {
  switch (status) {
    case "DRAFT":
      return "bg-slate-100 text-slate-700 border-slate-300";
    case "PUBLISHED":
      return "bg-amber-50 text-amber-800 border-amber-300";
    case "QUORUM_MET":
      return "bg-emerald-50 text-emerald-700 border-emerald-300";
    case "SUPERSEDED":
      return "bg-stone-100 text-stone-500 border-stone-200";
    case "EXPIRED":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "WITHDRAWN":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function BatchBuyOffersManager({
  instituteId,
  instituteName,
  cohorts,
  agreementsSummary,
}: BatchBuyOffersManagerProps) {
  const router = useRouter();
  const [selectedCohortId, setSelectedCohortId] = useState<string>(
    cohorts[0]?.cohortId ?? ""
  );
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [repName, setRepName] = useState("");
  const [repDesignation, setRepDesignation] = useState("");
  const [isPending, startTransition] = useTransition();

  const hasActiveAgreement = Boolean(agreementsSummary?.hasActiveAgreement);
  const activeAgreement = agreementsSummary?.activeAgreement ?? null;
  const draftAgreement = agreementsSummary?.history?.find((a) => a.status === "DRAFT") ?? null;

  const handleAcceptDraftAgreement = (agreementId: string) => {
    startTransition(async () => {
      const res = await acceptAndActivateAgreementAction({
        agreementId,
        acceptedRepresentativeName: repName,
        acceptedDesignation: repDesignation,
      });
      if (!res.success) {
        toast.error(res.error || "Unable to activate agreement.");
        return;
      }
      toast.success("Commercial Agreement signed and activated! Publishing unlocked.");
      setRepName("");
      setRepDesignation("");
      router.refresh();
    });
  };

  const selectedCohort = useMemo(
    () => cohorts.find((c) => c.cohortId === selectedCohortId) ?? cohorts[0] ?? null,
    [cohorts, selectedCohortId]
  );

  // Build initial defaults from selected cohort & matched effective slab
  const buildDefaults = (cohort: ManagerCohortOfferItem | null) => {
    const dates = defaultDates();
    if (!cohort) {
      return {
        sourceSlabId: null as string | null,
        title: "",
        baseFee: 100000,
        registrationFeeOriginal: 2500,
        waiveRegistration: true,
        discountPercentage: 10,
        includedPerks: ["All India Test Series"],
        fallbackPolicy: "ABSORB_SHORTFALL" as SlabFallbackPolicyType,
        minAcceptanceQuorum: 5,
        minAdmissionQuorum: 4,
        paymentTerms:
          "Direct institute payment at center counter or official portal upon voucher verification.",
        additionalNotes: "",
        ...dates,
      };
    }

    const matchingSlab =
      cohort.availableSlabs.find(
        (s) =>
          cohort.activeMemberCount >= s.minStudents &&
          (s.maxStudents === null || cohort.activeMemberCount <= s.maxStudents)
      ) ?? cohort.availableSlabs[0];

    const fallbackBaseFee =
      cohort.batch.fee && cohort.batch.fee > 0
        ? cohort.batch.fee
        : cohort.batch.originalFee && cohort.batch.originalFee > 0
        ? cohort.batch.originalFee
        : 100000;

    const minAcc = Math.max(1, Math.min(cohort.minRequired, cohort.maxCapacity));
    const minAdm = Math.max(1, Math.min(minAcc, cohort.minRequired));

    return {
      sourceSlabId: matchingSlab?.id ?? null,
      title: `${cohort.batch.name} — Official Group Offer`,
      baseFee: fallbackBaseFee,
      registrationFeeOriginal: 0,
      waiveRegistration: matchingSlab?.waiveRegistration ?? true,
      discountPercentage: matchingSlab?.discountPercentage ?? 10,
      includedPerks: matchingSlab?.includedPerks ?? [],
      fallbackPolicy:
        matchingSlab?.fallbackPolicy ?? ("ABSORB_SHORTFALL" as SlabFallbackPolicyType),
      minAcceptanceQuorum: minAcc,
      minAdmissionQuorum: minAdm,
      paymentTerms:
        "100% direct fee payment to institute upon BatchBuy voucher verification at center admission desk. No token collected by AcademyFind.",
      additionalNotes: matchingSlab?.notes ?? "",
      ...dates,
    };
  };

  const initialDefaults = useMemo(() => buildDefaults(selectedCohort), [selectedCohort]);

  const [sourceSlabId, setSourceSlabId] = useState<string | null>(initialDefaults.sourceSlabId);
  const [title, setTitle] = useState(initialDefaults.title);
  const [baseFee, setBaseFee] = useState<number>(initialDefaults.baseFee);
  const [registrationFeeOriginal, setRegistrationFeeOriginal] = useState<number>(
    initialDefaults.registrationFeeOriginal
  );
  const [waiveRegistration, setWaiveRegistration] = useState<boolean>(
    initialDefaults.waiveRegistration
  );
  const [discountPercentage, setDiscountPercentage] = useState<number>(
    initialDefaults.discountPercentage
  );
  const [includedPerks, setIncludedPerks] = useState<string[]>(initialDefaults.includedPerks);
  const [customPerk, setCustomPerk] = useState("");
  const [fallbackPolicy, setFallbackPolicy] = useState<SlabFallbackPolicyType>(
    initialDefaults.fallbackPolicy
  );
  const [minAcceptanceQuorum, setMinAcceptanceQuorum] = useState<number>(
    initialDefaults.minAcceptanceQuorum
  );
  const [minAdmissionQuorum, setMinAdmissionQuorum] = useState<number>(
    initialDefaults.minAdmissionQuorum
  );
  const [offerExpiresAt, setOfferExpiresAt] = useState<string>(initialDefaults.offerExpiresAt);
  const [voucherExpiresAt, setVoucherExpiresAt] = useState<string>(
    initialDefaults.voucherExpiresAt
  );
  const [paymentTerms, setPaymentTerms] = useState<string>(initialDefaults.paymentTerms);
  const [additionalNotes, setAdditionalNotes] = useState<string>(
    initialDefaults.additionalNotes
  );

  const loadCohortDefaults = (cohort: ManagerCohortOfferItem) => {
    setSelectedCohortId(cohort.cohortId);
    setEditingDraftId(null);
    const d = buildDefaults(cohort);
    setSourceSlabId(d.sourceSlabId);
    setTitle(d.title);
    setBaseFee(d.baseFee);
    setRegistrationFeeOriginal(d.registrationFeeOriginal);
    setWaiveRegistration(d.waiveRegistration);
    setDiscountPercentage(d.discountPercentage);
    setIncludedPerks(d.includedPerks);
    setFallbackPolicy(d.fallbackPolicy);
    setMinAcceptanceQuorum(d.minAcceptanceQuorum);
    setMinAdmissionQuorum(d.minAdmissionQuorum);
    setOfferExpiresAt(d.offerExpiresAt);
    setVoucherExpiresAt(d.voucherExpiresAt);
    setPaymentTerms(d.paymentTerms);
    setAdditionalNotes(d.additionalNotes);
  };

  const loadDraftIntoForm = (offer: SerializedCohortOfferSummary) => {
    if (offer.status !== "DRAFT") {
      toast.error("Published offers are immutable. Create a new version instead.");
      return;
    }
    setEditingDraftId(offer.id);
    setSourceSlabId(offer.sourceSlabId);
    setTitle(offer.title);
    setBaseFee(offer.baseFee);
    setRegistrationFeeOriginal(offer.registrationFeeOriginal);
    setWaiveRegistration(offer.waiveRegistration);
    setDiscountPercentage(offer.discountPercentage);
    setIncludedPerks(offer.includedPerks);
    setFallbackPolicy(offer.fallbackPolicy);
    setMinAcceptanceQuorum(offer.minAcceptanceQuorum);
    setMinAdmissionQuorum(offer.minAdmissionQuorum);
    setOfferExpiresAt(toDatetimeLocalValue(offer.offerExpiresAt));
    setVoucherExpiresAt(toDatetimeLocalValue(offer.voucherExpiresAt));
    setPaymentTerms(offer.paymentTerms ?? "");
    setAdditionalNotes(offer.additionalNotes ?? "");
    toast.success(`Loaded Offer v${offer.version} draft into editor`);
  };

  const applySlabPreset = (slabId: string) => {
    if (!selectedCohort) return;
    const slab = selectedCohort.availableSlabs.find((s) => s.id === slabId);
    if (!slab) return;
    setSourceSlabId(slab.id);
    setDiscountPercentage(slab.discountPercentage);
    setWaiveRegistration(slab.waiveRegistration);
    setIncludedPerks(slab.includedPerks);
    setFallbackPolicy(slab.fallbackPolicy);
    toast.success(`Applied ${slab.minStudents}${slab.maxStudents ? `-${slab.maxStudents}` : "+"} tier (${slab.discountPercentage}% OFF)`);
  };

  const addPerk = () => {
    const trimmed = customPerk.trim();
    if (!trimmed || includedPerks.includes(trimmed) || includedPerks.length >= 12) return;
    setIncludedPerks([...includedPerks, trimmed]);
    setCustomPerk("");
  };

  const liveBreakdown = useMemo(
    () =>
      computeOfferFeeBreakdown({
        baseFee: Number.isFinite(baseFee) && baseFee > 0 ? baseFee : 0,
        registrationFeeOriginal:
          Number.isFinite(registrationFeeOriginal) && registrationFeeOriginal >= 0
            ? registrationFeeOriginal
            : 0,
        waiveRegistration,
        discountPercentage:
          Number.isFinite(discountPercentage) && discountPercentage >= 0
            ? discountPercentage
            : 0,
      }),
    [baseFee, registrationFeeOriginal, waiveRegistration, discountPercentage]
  );

  const handleSaveOffer = (publishImmediately: boolean) => {
    if (!selectedCohort) return;
    startTransition(async () => {
      const res = await saveCohortOfferAction({
        offerId: editingDraftId,
        cohortId: selectedCohort.cohortId,
        sourceSlabId,
        title,
        baseFee,
        registrationFeeOriginal,
        waiveRegistration,
        discountPercentage,
        includedPerks,
        fallbackPolicy,
        minAcceptanceQuorum,
        minAdmissionQuorum,
        offerExpiresAt: new Date(offerExpiresAt).toISOString(),
        voucherExpiresAt: new Date(voucherExpiresAt).toISOString(),
        paymentTerms,
        additionalNotes,
        publishImmediately,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to save offer.");
        return;
      }

      toast.success(
        publishImmediately
          ? `Offer v${res.version} published and locked! Cohort members notified.`
          : `Offer v${res.version} saved as Draft.`
      );
      setEditingDraftId(null);
      router.refresh();
    });
  };

  const handlePublishDraft = (offerId: string) => {
    startTransition(async () => {
      const res = await publishDraftCohortOfferAction(offerId);
      if (!res.success) {
        toast.error(res.error || "Could not publish draft.");
        return;
      }
      toast.success(`Offer v${res.version} is now live!`);
      setEditingDraftId(null);
      router.refresh();
    });
  };

  const handleWithdrawOffer = (offerId: string, version: number) => {
    startTransition(async () => {
      const res = await withdrawCohortOfferAction(offerId);
      if (!res.success) {
        toast.error(res.error || "Could not withdraw offer.");
        return;
      }
      toast.success(`Offer v${version} withdrawn and unredeemed vouchers revoked.`);
      if (editingDraftId === offerId) setEditingDraftId(null);
      router.refresh();
    });
  };

  const agreementBanner = (
    <div
      className={`rounded-3xl border p-5 backdrop-blur-md space-y-3 ${
        hasActiveAgreement
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-amber-300 bg-amber-50/80"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {hasActiveAgreement ? (
            <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
          )}
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              {hasActiveAgreement && activeAgreement
                ? `Active BatchBuy Commercial Agreement v${activeAgreement.version} (${activeAgreement.commissionRatePct}% Net Tuition Rate)`
                : "BatchBuy Commercial Agreement Required to Publish Offers"}
            </div>
            {hasActiveAgreement && activeAgreement ? (
              <p className="text-xs text-emerald-900 mt-0.5">
                Signed by <strong>{activeAgreement.acceptedRepresentativeName}</strong> (
                {activeAgreement.acceptedDesignation}) · Commission base strictly settled tuition
                only · {activeAgreement.holdingPeriodDays}-day AcademyFind cooling-off hold ·{" "}
                {activeAgreement.attributionWindowDays}-day attribution window (+18% GST billed
                separately).
              </p>
            ) : (
              <p className="text-xs text-amber-950 mt-0.5">
                You may compose Draft offers, but an active signed{" "}
                <strong>InstituteBatchBuyAgreement</strong> (2% / 3% / 4% rate tier) is mandatory
                before any offer can be published to students.
              </p>
            )}
          </div>
        </div>
        <Link
          href={`/manager/${instituteId}/batchbuy/redemptions`}
          className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-1.5 text-xs font-bold text-slate-700 transition-colors"
        >
          View Ledger &amp; Invoices
        </Link>
      </div>

      {!hasActiveAgreement && draftAgreement && (
        <div className="rounded-2xl border border-amber-300/80 bg-white/95 p-4 space-y-3">
          <div className="text-xs font-bold text-slate-800">
            Pending Commercial Agreement v{draftAgreement.version} awaiting Institute Signature —{" "}
            <span className="text-amber-700">
              {draftAgreement.commissionRatePct}% on Settled Tuition Only (+18% GST separate)
            </span>{" "}
            · {draftAgreement.holdingPeriodDays}-day commercial cooling-off hold
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              placeholder="Authorized Signatory Full Name"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Designation (e.g., Center Director)"
              value={repDesignation}
              onChange={(e) => setRepDesignation(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
            />
            <Button
              type="button"
              disabled={isPending || !repName.trim() || !repDesignation.trim()}
              onClick={() => handleAcceptDraftAgreement(draftAgreement.id)}
              className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer h-9"
            >
              Sign &amp; Activate v{draftAgreement.version}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (cohorts.length === 0 || !selectedCohort) {
    return (
      <div className="space-y-5">
        {agreementBanner}
        <div className="rounded-3xl border border-slate-200/80 bg-white/85 backdrop-blur-md p-10 text-center shadow-xs">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <Users className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-extrabold text-slate-900">No Student Cohorts Yet</h3>
        <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
          When verified student cohorts form for {instituteName} batches, they will appear
          here so you can publish locked versioned group fee offers and track dual quorums.
        </p>
        <div className="mt-5">
          <Button asChild className="rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold">
            <Link href={`/manager/${instituteId}/batchbuy/slabs`}>
              Configure Group Discount Slabs
            </Link>
          </Button>
        </div>
      </div>
      </div>
    );
  }

  const nextVersionNumber =
    selectedCohort.offers.reduce((max, o) => Math.max(max, o.version), 0) + 1;

  return (
    <div className="space-y-6">
      {agreementBanner}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Column: Institute Cohort Queue */}
      <aside className="xl:col-span-4 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
          Cohorts Targeting {instituteName} ({cohorts.length})
        </div>

        <div className="space-y-3">
          {cohorts.map((cohort) => {
            const isSelected = cohort.cohortId === selectedCohort.cohortId;
            const liveOffer = cohort.offers.find(
              (o) => o.status === "PUBLISHED" || o.status === "QUORUM_MET"
            );

            return (
              <button
                key={cohort.cohortId}
                type="button"
                onClick={() => loadCohortDefaults(cohort)}
                className={`w-full text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                  isSelected
                    ? "border-amber-400 bg-amber-50/70 shadow-sm ring-1 ring-amber-300/60"
                    : "border-slate-200/80 bg-white/85 hover:border-amber-300 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full">
                    {cohort.cohortCode}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                    {cohort.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="mt-2 font-bold text-sm text-slate-900 line-clamp-1">
                  {cohort.title}
                </div>
                <div className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                  {cohort.batch.name} · {cohort.examCategory} {cohort.targetAcademicYear}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 font-semibold text-slate-700">
                    {cohort.activeMemberCount}/{cohort.targetSize} members
                  </span>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 font-semibold text-emerald-700">
                    {cohort.verifiedMemberCount} 3-level verified
                  </span>
                  {liveOffer && (
                    <span className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 font-bold text-amber-900">
                      Offer v{liveOffer.version}: {liveOffer.acceptedCount}/
                      {liveOffer.minAcceptanceQuorum} accepted
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right Column: Version History + Offer Composer */}
      <section className="xl:col-span-8 space-y-6">
        {/* Selected Cohort Header + Existing Offer Versions */}
        <div className="rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold text-amber-700">
                <Building2 className="w-4 h-4" />
                <span>{selectedCohort.cohortCode}</span>
                <span>·</span>
                <span>{selectedCohort.batch.name}</span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 mt-1">
                {selectedCohort.title}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {selectedCohort.activeMemberCount} active aspirants ({selectedCohort.verifiedMemberCount}{" "}
                intent-verified) · Slab Source:{" "}
                <strong className="text-slate-800">{selectedCohort.slabScope.replace(/_/g, " ")}</strong>
              </p>
            </div>

            <Link
              href={`/batchbuy/${selectedCohort.cohortCode}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors"
            >
              <span>Preview Cohort Room</span>
            </Link>
          </div>

          {/* Version History Audit Trail */}
          {selectedCohort.offers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-600" />
                  <span>Versioned Offer History (Published Terms Are Immutable)</span>
                </h3>
                {editingDraftId && (
                  <button
                    type="button"
                    onClick={() => loadCohortDefaults(selectedCohort)}
                    className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer"
                  >
                    + Switch to New Version (v{nextVersionNumber})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedCohort.offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        Offer v{offer.version} · {offer.discountPercentage}% OFF
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${offerStatusPill(
                          offer.effectiveStatus
                        )}`}
                      >
                        {offer.effectiveStatus.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 tabular-nums">
                      <div>
                        Net Tuition:{" "}
                        <strong className="text-slate-900">
                          {formatINR(offer.netPayableTuition)}
                        </strong>
                      </div>
                      <div>
                        Base Fee:{" "}
                        <span className="line-through text-slate-400">
                          {formatINR(offer.baseFee)}
                        </span>
                      </div>
                      <div>
                        Acceptance Quorum:{" "}
                        <strong className="text-emerald-700">
                          {offer.acceptedCount}/{offer.minAcceptanceQuorum}
                        </strong>
                      </div>
                      <div>
                        Admission Quorum:{" "}
                        <strong className="text-amber-700">
                          0/{offer.minAdmissionQuorum}
                        </strong>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500">
                      Fallback: <strong>{getFallbackPolicyMeta(offer.fallbackPolicy).label}</strong> ·
                      Declined: {offer.declinedCount} · Active Vouchers: {offer.activeVoucherCount}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {offer.status === "DRAFT" && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => loadDraftIntoForm(offer)}
                            disabled={isPending}
                            className="h-8 rounded-full text-xs font-bold cursor-pointer"
                          >
                            Edit Draft
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handlePublishDraft(offer.id)}
                            disabled={isPending || !hasActiveAgreement}
                            title={
                              !hasActiveAgreement
                                ? "Active signed Commercial Agreement required to publish."
                                : undefined
                            }
                            className="h-8 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            Publish v{offer.version}
                          </Button>
                        </>
                      )}

                      {["DRAFT", "PUBLISHED", "QUORUM_MET"].includes(offer.effectiveStatus) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleWithdrawOffer(offer.id, offer.version)}
                          disabled={isPending}
                          className="h-8 rounded-full text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Versioned Offer Composer */}
        <div className="rounded-3xl border border-amber-200/80 bg-white/95 backdrop-blur-md p-6 shadow-[0_12px_36px_rgba(251,191,36,0.08)] space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/90 px-3 py-1 text-xs font-extrabold text-amber-900">
                <FilePlus2 className="w-3.5 h-3.5" />
                {editingDraftId ? "Editing Draft Offer" : `Drafting Offer v${nextVersionNumber}`}
              </span>
              <h3 className="text-lg font-extrabold text-slate-900 mt-2">
                {editingDraftId
                  ? "Update Draft Commercial Terms"
                  : `Create New Versioned Offer (v${nextVersionNumber})`}
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Publishing locks pricing, discount tier, fallback policy, and dual quorums
                immutably. Publishing a new version automatically supersedes prior active offers.
              </p>
            </div>
          </div>

          {/* Pre-fill from Slab Tier */}
          {selectedCohort.availableSlabs.length > 0 && (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/50 p-4 space-y-2.5">
              <div className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Apply Effective Slab Tier Preset</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedCohort.availableSlabs.map((slab) => (
                  <button
                    key={slab.id}
                    type="button"
                    onClick={() => applySlabPreset(slab.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      sourceSlabId === slab.id
                        ? "border-amber-500 bg-amber-500 text-white shadow-xs"
                        : "border-amber-200 bg-white text-slate-700 hover:border-amber-400"
                    }`}
                  >
                    {slab.minStudents}
                    {slab.maxStudents ? `–${slab.maxStudents}` : "+"} students ·{" "}
                    {slab.discountPercentage}% OFF
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Form Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Offer Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Listed Batch Base Fee (INR)
              </label>
              <input
                type="number"
                min={100}
                step={100}
                value={baseFee}
                onChange={(e) => setBaseFee(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold tabular-nums text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Group Discount (%) [0.5% – 50%]
              </label>
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={discountPercentage}
                onChange={(e) => setDiscountPercentage(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold tabular-nums text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Original Registration Fee (INR)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={registrationFeeOriginal}
                onChange={(e) => setRegistrationFeeOriginal(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold tabular-nums text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={waiveRegistration}
                  onChange={(e) => setWaiveRegistration(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-bold text-slate-800">
                  Waive Registration Fee for Cohort Members
                </span>
              </label>
            </div>

            {/* Dual Quorums */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5">
              <label className="block text-xs font-extrabold text-emerald-900 mb-1">
                Min Acceptance Quorum (Unlocks Vouchers)
              </label>
              <input
                type="number"
                min={1}
                max={selectedCohort.maxCapacity}
                value={minAcceptanceQuorum}
                onChange={(e) => setMinAcceptanceQuorum(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-bold tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none"
              />
              <p className="text-[11px] text-emerald-800 mt-1">
                Number of students who must individually accept before vouchers become ACTIVE.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5">
              <label className="block text-xs font-extrabold text-amber-900 mb-1">
                Min Center Admission Quorum (Settlement Gate)
              </label>
              <input
                type="number"
                min={1}
                max={minAcceptanceQuorum}
                value={minAdmissionQuorum}
                onChange={(e) => setMinAdmissionQuorum(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-bold tabular-nums text-slate-900 focus:border-amber-500 focus:outline-none"
              />
              <p className="text-[11px] text-amber-900 mt-1">
                Students required to enroll at center (tracked separately at redemption).
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Locked Shortfall / Fallback Policy
              </label>
              <select
                value={fallbackPolicy}
                onChange={(e) => setFallbackPolicy(e.target.value as SlabFallbackPolicyType)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none"
              >
                <option value="ABSORB_SHORTFALL">
                  Absorb Shortfall — Guarantee Group Discount
                </option>
                <option value="REVERT_TO_LOWER_SLAB">
                  Revert to Actual Achieved Slab at Admission
                </option>
                <option value="CANCEL_DISCOUNT">
                  Cancel Group Discount Below Admission Quorum
                </option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:col-span-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Offer Response Deadline
                </label>
                <input
                  type="datetime-local"
                  value={offerExpiresAt}
                  onChange={(e) => setOfferExpiresAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Voucher Validity Deadline
                </label>
                <input
                  type="datetime-local"
                  value={voucherExpiresAt}
                  onChange={(e) => setVoucherExpiresAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Included Perks */}
            <div className="md:col-span-2 space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Included Group Perks ({includedPerks.length}/12)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPerk}
                  onChange={(e) => setCustomPerk(e.target.value)}
                  placeholder="e.g. Free Test Series, Study Material Pack..."
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addPerk}
                  className="rounded-xl cursor-pointer"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
              {includedPerks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {includedPerks.map((perk) => (
                    <span
                      key={perk}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      <span>{perk}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setIncludedPerks(includedPerks.filter((p) => p !== perk))
                        }
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        aria-label={`Remove ${perk}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Direct Payment &amp; Installment Terms
              </label>
              <textarea
                rows={2}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Live Locked Breakdown Preview */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Computed Immutable Student Fee Breakdown
              </div>
              <div className="flex flex-wrap items-baseline gap-3 tabular-nums">
                <span className="text-2xl font-extrabold text-emerald-700">
                  {formatINR(liveBreakdown.netPayableTuition)}
                </span>
                <span className="text-sm line-through text-slate-400">
                  {formatINR(liveBreakdown.baseFee)}
                </span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-emerald-800">
                  Save {formatINR(liveBreakdown.totalSavings)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSaveOffer(false)}
                disabled={isPending}
                className="rounded-full border-slate-300 font-bold cursor-pointer h-11 px-5"
              >
                Save as Draft
              </Button>
              <Button
                type="button"
                onClick={() => handleSaveOffer(true)}
                disabled={isPending || !hasActiveAgreement}
                title={
                  !hasActiveAgreement
                    ? "Active signed Commercial Agreement required to publish. Save as Draft instead."
                    : undefined
                }
                className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold shadow-md shadow-amber-500/20 cursor-pointer h-11 px-6 disabled:opacity-50"
              >
                <Send className="w-4 h-4 mr-2" />
                {editingDraftId ? "Save & Publish Offer" : `Publish Offer v${nextVersionNumber}`}
              </Button>
            </div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
