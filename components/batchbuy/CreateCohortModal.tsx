"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createBatchBuyCohort,
  getSlabsForCohortSetupAction,
  searchInstitutesAction,
} from "@/lib/batchbuy/cohortActions";
import { SearchInstituteBatchOption } from "@/lib/batchbuy/cohortQueries";
import { COHORT_EXAM_CATEGORIES } from "@/lib/batchbuy/cohortValidation";
import { SlabResolutionResult } from "@/lib/batchbuy/slabResolver";
import { formatINR, getFallbackPolicyMeta } from "./fallbackPolicyInfo";

interface CreateCohortModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoggedIn: boolean;
  accountPhoneVerified: boolean;
  profilePrefill?: {
    targetExam?: string | null;
    targetYear?: number | null;
    currentClass?: string | null;
  };
  presetInstitute?: SearchInstituteBatchOption | null;
  initialBatchId?: string | null;
  callbackPath?: string;
}

export function CreateCohortModal({
  open,
  onOpenChange,
  isLoggedIn,
  accountPhoneVerified,
  profilePrefill,
  presetInstitute,
  initialBatchId,
  callbackPath = "/batchbuy",
}: CreateCohortModalProps) {
  const router = useRouter();

  const [instituteSearch, setInstituteSearch] = useState("");
  const [instituteOptions, setInstituteOptions] = useState<SearchInstituteBatchOption[]>(
    presetInstitute ? [presetInstitute] : []
  );
  const [loadingInstitutes, setLoadingInstitutes] = useState(false);

  const [selectedInstituteId, setSelectedInstituteId] = useState(
    presetInstitute?.id || ""
  );
  const [selectedBatchId, setSelectedBatchId] = useState(
    initialBatchId || presetInstitute?.batches[0]?.id || "__auto_comp__"
  );
  const [customBatchName, setCustomBatchName] = useState("");

  const [slabResolution, setSlabResolution] = useState<SlabResolutionResult>({
    scope: "NONE",
    slabs: [],
  });
  const [loadingSlabs, setLoadingSlabs] = useState(false);

  const [title, setTitle] = useState("");
  const [examCategory, setExamCategory] = useState(
    profilePrefill?.targetExam || "JEE"
  );
  const [targetAcademicYear, setTargetAcademicYear] = useState(
    profilePrefill?.targetYear || new Date().getFullYear()
  );
  const [minRequired, setMinRequired] = useState(5);
  const [targetSize, setTargetSize] = useState(10);
  const [formingDays, setFormingDays] = useState(14);
  const [currentClass, setCurrentClass] = useState(
    profilePrefill?.currentClass || "Class 12"
  );
  const [confirmIntent, setConfirmIntent] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedInstitute =
    presetInstitute && presetInstitute.id === selectedInstituteId
      ? presetInstitute
      : instituteOptions.find((i) => i.id === selectedInstituteId) || null;

  const selectedBatch =
    selectedInstitute?.batches.find((b) => b.id === selectedBatchId) || null;

  const performSearch = async (term: string) => {
    setLoadingInstitutes(true);
    try {
      const res = await searchInstitutesAction(term);
      if (res.success) {
        setInstituteOptions(res.institutes);
        if (res.institutes.length > 0) {
          const isStillPresent = res.institutes.some(
            (i) => i.id === selectedInstituteId
          );
          if (!selectedInstituteId || !isStillPresent) {
            const first = res.institutes[0];
            setSelectedInstituteId(first.id);
            setSelectedBatchId(first.batches[0]?.id || "__auto_comp__");
          }
        }
      }
    } finally {
      setLoadingInstitutes(false);
    }
  };

  // Load initial institute options when opened without preset & debounce on typing
  useEffect(() => {
    if (!open || presetInstitute) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingInstitutes(true);
      const res = await searchInstitutesAction(instituteSearch);
      if (active && res.success) {
        setInstituteOptions(res.institutes);
        if (res.institutes.length > 0) {
          const isStillPresent = res.institutes.some(
            (i) => i.id === selectedInstituteId
          );
          if (!selectedInstituteId || !isStillPresent) {
            const first = res.institutes[0];
            setSelectedInstituteId(first.id);
            setSelectedBatchId(first.batches[0]?.id || "__auto_comp__");
          }
        }
      }
      if (active) setLoadingInstitutes(false);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, instituteSearch, presetInstitute, selectedInstituteId]);

  // Update preset state if props change
  useEffect(() => {
    if (presetInstitute) {
      setSelectedInstituteId(presetInstitute.id);
      const nextBatchId = initialBatchId || presetInstitute.batches[0]?.id || "__auto_comp__";
      setSelectedBatchId(nextBatchId);
    }
  }, [presetInstitute, initialBatchId]);

  // Auto-resolve effective slabs whenever institute + batch changes
  useEffect(() => {
    if (!open || !selectedInstituteId) return;
    let active = true;
    (async () => {
      setLoadingSlabs(true);
      const res = await getSlabsForCohortSetupAction(
        selectedInstituteId,
        selectedBatchId || null
      );
      if (active && res.success) {
        setSlabResolution(res.resolution);
        if (res.resolution.slabs.length > 0) {
          const firstMin = Math.max(2, res.resolution.slabs[0].minStudents);
          const highestMin = res.resolution.slabs[res.resolution.slabs.length - 1].minStudents;
          setMinRequired(firstMin);
          setTargetSize(Math.max(firstMin, Math.min(50, highestMin)));
        }
      }
      if (active) setLoadingSlabs(false);
    })();
    return () => {
      active = false;
    };
  }, [open, selectedInstituteId, selectedBatchId]);

  // Suggest smart default title when institute & batch are picked and user hasn't typed a custom one
  useEffect(() => {
    if (!selectedInstitute) return;
    if (!title.trim() || title.includes("BatchBuy") || title.includes("Cohort") || title.includes("—")) {
      const bName =
        selectedBatch?.name ||
        (selectedBatchId === "__custom__" && customBatchName.trim()
          ? customBatchName.trim()
          : selectedBatchId === "__auto_dropper__"
          ? `${examCategory} Droppers Batch`
          : selectedBatchId === "__auto_foundation__"
          ? `${examCategory} Foundation Batch`
          : selectedBatchId === "__auto_crash__"
          ? `${examCategory} Crash Course`
          : `${examCategory} Classroom Program`);

      setTitle(`${selectedInstitute.name} — ${bName} (${targetAcademicYear})`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedInstitute?.id,
    selectedInstitute?.name,
    selectedBatch?.id,
    selectedBatch?.name,
    selectedBatchId,
    customBatchName,
    examCategory,
    targetAcademicYear,
  ]);

  const handleSelectInstitute = (instId: string) => {
    setSelectedInstituteId(instId);
    const inst = instituteOptions.find((i) => i.id === instId);
    if (inst && inst.batches.length > 0) {
      setSelectedBatchId(inst.batches[0].id);
    } else {
      setSelectedBatchId("__auto_comp__");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
      return;
    }
    if (!selectedInstituteId || !selectedBatchId) {
      toast.error("Please select an institute and batch first.");
      return;
    }
    if (selectedBatchId === "__custom__" && !customBatchName.trim()) {
      toast.error("Please enter a custom batch or course name.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createBatchBuyCohort({
        instituteId: selectedInstituteId,
        batchId: selectedBatchId,
        customBatchName: selectedBatchId === "__custom__" ? customBatchName.trim() : undefined,
        title: title.trim(),
        examCategory,
        targetAcademicYear: Number(targetAcademicYear),
        minRequired: Number(minRequired),
        targetSize: Number(targetSize),
        maxCapacity: Math.max(25, Number(targetSize) + 10),
        formingDays: Number(formingDays),
        intent: {
          confirmIntent,
          targetExam: examCategory,
          targetAcademicYear: Number(targetAcademicYear),
          currentClass,
          isMinor,
          parentName: isMinor ? parentName : undefined,
          parentPhone: isMinor ? parentPhone : undefined,
        },
      });

      if (!res.success) {
        if ("existingCohortCode" in res && res.existingCohortCode) {
          toast.error(res.error || "You already have an active cohort for this batch.");
          onOpenChange(false);
          router.push(`/batchbuy/${res.existingCohortCode}`);
          return;
        }
        toast.error(res.error || "Could not create cohort.");
        return;
      }

      toast.success(res.message || "Cohort created!");
      onOpenChange(false);
      router.push(`/batchbuy/${res.cohortCode}`);
    } catch {
      toast.error("Unexpected error while creating cohort.");
    } finally {
      setSubmitting(false);
    }
  };

  const primaryFallbackPolicy = slabResolution.slabs[0]?.fallbackPolicy || null;
  const policyMeta = getFallbackPolicyMeta(primaryFallbackPolicy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border-amber-200/80 bg-white p-6">
        <DialogHeader className="space-y-1.5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Start a BatchBuy Cohort</span>
          </div>
          <DialogTitle className="text-xl sm:text-2xl font-extrabold text-slate-900">
            Rally Aspirants for Collective Tuition Discounts
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Form a verified group for the same batch, get a private cohort room &amp; WhatsApp
            invite link, and unlock group fee slabs with zero platform advance.
          </DialogDescription>
        </DialogHeader>

        {!isLoggedIn ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-center space-y-4">
            <Building2 className="w-10 h-10 text-amber-600 mx-auto" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Sign in to launch your BatchBuy Cohort
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                We verify student accounts so coaching institutes treat every cohort proposal as
                genuine admission demand.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold px-6 h-11"
              >
                <Link href={`/login?callbackUrl=${encodeURIComponent(callbackPath)}`}>
                  Login to Continue
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full px-5 h-11">
                <Link href={`/register?callbackUrl=${encodeURIComponent(callbackPath)}`}>
                  Create Student Account
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            {/* Step 1: Institute & Batch Selection */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Coaching Institute &amp; Batch
              </h3>

              {!presetInstitute && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="create-cohort-search-input"
                      className="text-xs font-semibold text-slate-700"
                    >
                      Search Coaching Center / Institute
                    </Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="create-cohort-search-input"
                          value={instituteSearch}
                          onChange={(e) => setInstituteSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              performSearch(instituteSearch);
                            }
                          }}
                          placeholder="Type name or city (e.g. Entropy, Allen, Kota)..."
                          className="pl-9 pr-8 h-10 rounded-xl bg-white text-sm"
                        />
                        {instituteSearch && (
                          <button
                            type="button"
                            onClick={() => {
                              setInstituteSearch("");
                              performSearch("");
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded"
                            title="Clear search"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <Button
                        type="button"
                        onClick={() => performSearch(instituteSearch)}
                        disabled={loadingInstitutes}
                        className="h-10 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-sm"
                      >
                        {loadingInstitutes ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                        <span>Search</span>
                      </Button>
                    </div>

                    {/* Search result count / status hint */}
                    <div className="text-[11px] text-slate-500 px-0.5 min-h-[16px] flex items-center">
                      {loadingInstitutes ? (
                        <span className="text-amber-600 font-medium flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Searching coaching institutes...
                        </span>
                      ) : instituteSearch.trim() ? (
                        instituteOptions.length > 0 ? (
                          <span className="text-emerald-700 font-medium">
                            ✓ Found {instituteOptions.length} matching institute{instituteOptions.length > 1 ? "s" : ""} — choose below:
                          </span>
                        ) : (
                          <span className="text-rose-600 font-medium">
                            No institutes matched &quot;{instituteSearch}&quot;. Try city name or shorter keyword.
                          </span>
                        )
                      ) : (
                        <span>Type coaching name &amp; click Search, or pick from popular institutes:</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="create-cohort-institute"
                        className="text-xs font-semibold text-slate-700"
                      >
                        Select Institute / Center
                      </Label>
                      {instituteOptions.length > 0 && (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {instituteOptions.length} available
                        </span>
                      )}
                    </div>
                    <select
                      id="create-cohort-institute"
                      value={selectedInstituteId}
                      onChange={(e) => handleSelectInstitute(e.target.value)}
                      disabled={loadingInstitutes || instituteOptions.length === 0}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                    >
                      {instituteOptions.length === 0 ? (
                        <option value="">
                          {loadingInstitutes
                            ? "Searching coaching institutes..."
                            : "No coaching institutes matched. Try another keyword or city name."}
                        </option>
                      ) : (
                        instituteOptions.map((inst) => (
                          <option key={inst.id} value={inst.id}>
                            {inst.name} ({inst.cityName})
                            {inst.hasSlabs ? " — Partner Slabs Live" : ""}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              )}

              {presetInstitute && (
                <div className="rounded-xl border border-amber-200/80 bg-white px-3.5 py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{presetInstitute.name}</div>
                    <div className="text-xs text-slate-500">{presetInstitute.cityName}</div>
                  </div>
                  {presetInstitute.hasSlabs && (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                      Partner Slabs Ready
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="create-cohort-batch" className="text-xs font-semibold text-slate-700">
                  Target Batch / Course
                </Label>
                <select
                  id="create-cohort-batch"
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                >
                  {selectedInstitute && selectedInstitute.batches.length > 0 ? (
                    <>
                      <optgroup label="Official Pre-Configured Batches">
                        {selectedInstitute.batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            {batch.name}
                            {batch.fee ? ` — ${formatINR(batch.fee)}` : ""} ({batch.mode})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Standard Programs">
                        <option value="__auto_comp__">
                          {examCategory} Comprehensive Classroom Program ({targetAcademicYear})
                        </option>
                        <option value="__custom__">+ Enter Custom Batch or Course Name</option>
                      </optgroup>
                    </>
                  ) : (
                    <>
                      <option value="__auto_comp__">
                        {examCategory} Comprehensive Classroom Program ({targetAcademicYear})
                      </option>
                      <option value="__auto_dropper__">
                        {examCategory} Droppers / Target Repeaters Batch ({targetAcademicYear})
                      </option>
                      <option value="__auto_foundation__">
                        {examCategory} Foundation Program (Class 11 &amp; 12)
                      </option>
                      <option value="__auto_crash__">
                        {examCategory} Fast-Track / Crash Course ({targetAcademicYear})
                      </option>
                      <option value="__custom__">+ Enter Custom Batch or Course Name</option>
                    </>
                  )}
                </select>

                {selectedBatchId === "__custom__" && (
                  <div className="space-y-1 pt-2">
                    <Label htmlFor="create-cohort-custom-batch" className="text-xs font-semibold text-slate-700">
                      Specify Custom Program / Course Name
                    </Label>
                    <Input
                      id="create-cohort-custom-batch"
                      value={customBatchName}
                      onChange={(e) => setCustomBatchName(e.target.value)}
                      placeholder={`e.g. ${examCategory} Intensive 2-Year Program / Dropper Batch`}
                      className="h-10 rounded-xl bg-white"
                      autoFocus
                    />
                  </div>
                )}
              </div>

              {/* Live Slab Resolution Preview */}
              {selectedInstituteId && (
                <div className="rounded-xl border border-amber-200/80 bg-white p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-amber-600" />
                      {slabResolution.scope === "NONE"
                        ? "Demand-Triggered Proposal Mode"
                        : slabResolution.scope === "BATCH_OVERRIDE"
                        ? "Batch-Specific Discount Slabs"
                        : "Institute-Wide Discount Slabs"}
                    </span>
                    {loadingSlabs && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />}
                  </div>

                  {slabResolution.slabs.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {slabResolution.slabs.map((slab) => (
                          <div
                            key={slab.id}
                            className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs"
                          >
                            <span className="font-extrabold text-amber-900">
                              {slab.discountPercentage}% OFF
                            </span>{" "}
                            <span className="text-slate-700">
                              for {slab.minStudents}
                              {slab.maxStudents ? `–${slab.maxStudents}` : "+"} students
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className={`rounded-xl border p-2.5 text-[11px] ${policyMeta.toneClass}`}>
                        <strong className="inline-flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5" /> Shortfall Policy:{" "}
                          {policyMeta.label}
                        </strong>
                        <p className="mt-0.5 opacity-90">{policyMeta.studentExplanation}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      This institute hasn&apos;t pre-published slabs yet. Once your cohort hits
                      minimum quorum ({minRequired}+ verified students), your cohort can formally
                      request a collective offer from the center.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Cohort Parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="cohort-title" className="text-xs font-semibold text-slate-700">
                  Cohort Title
                </Label>
                <Input
                  id="cohort-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Allen Kota Nurture JEE 2027 Morning Cohort"
                  required
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-exam" className="text-xs font-semibold text-slate-700">
                  Exam Category
                </Label>
                <select
                  id="cohort-exam"
                  value={examCategory}
                  onChange={(e) => setExamCategory(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                >
                  {COHORT_EXAM_CATEGORIES.map((exam) => (
                    <option key={exam} value={exam}>
                      {exam}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-year" className="text-xs font-semibold text-slate-700">
                  Target Academic Year
                </Label>
                <Input
                  id="cohort-year"
                  type="number"
                  min={2025}
                  max={2032}
                  value={targetAcademicYear}
                  onChange={(e) => setTargetAcademicYear(Number(e.target.value))}
                  required
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-min" className="text-xs font-semibold text-slate-700">
                  Min Quorum (Students)
                </Label>
                <Input
                  id="cohort-min"
                  type="number"
                  min={2}
                  max={50}
                  value={minRequired}
                  onChange={(e) => setMinRequired(Number(e.target.value))}
                  required
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-target" className="text-xs font-semibold text-slate-700">
                  Target Group Size
                </Label>
                <Input
                  id="cohort-target"
                  type="number"
                  min={2}
                  max={50}
                  value={targetSize}
                  onChange={(e) => setTargetSize(Number(e.target.value))}
                  required
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-class" className="text-xs font-semibold text-slate-700">
                  Your Current Class / Stage
                </Label>
                <Input
                  id="cohort-class"
                  value={currentClass}
                  onChange={(e) => setCurrentClass(e.target.value)}
                  placeholder="Class 11 / Class 12 / Dropper"
                  required
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cohort-days" className="text-xs font-semibold text-slate-700">
                  Forming Window (Days)
                </Label>
                <select
                  id="cohort-days"
                  value={formingDays}
                  onChange={(e) => setFormingDays(Number(e.target.value))}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                >
                  <option value={7}>7 days (Fast track)</option>
                  <option value={14}>14 days (Recommended)</option>
                  <option value={21}>21 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </div>

            {/* Account Phone OTP Status */}
            <div
              className={`rounded-2xl border p-3.5 flex items-center gap-3 text-xs ${
                accountPhoneVerified
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  : "border-amber-200 bg-amber-50/70 text-amber-900"
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>
                {accountPhoneVerified ? (
                  <>
                    <strong>Mobile Verified:</strong> You will join as an{" "}
                    <strong>Intent-Verified</strong> cohort founder.
                  </>
                ) : (
                  <>
                    <strong>Phone OTP Pending:</strong> You can launch now and{" "}
                    <Link href="/settings/profile" className="underline font-bold">
                      verify your mobile number
                    </Link>{" "}
                    before offers are requested.
                  </>
                )}
              </span>
            </div>

            {/* Minor DPDPA Section */}
            <div className="space-y-3 rounded-2xl border border-slate-200/80 p-3.5">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={isMinor}
                  onChange={(e) => setIsMinor(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  <strong className="text-slate-900">I am under 18 years old</strong> (Parent/guardian
                  contact recorded for awareness; verified parental consent is required prior to
                  offer acceptance).
                </span>
              </label>

              {isMinor && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <Input
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    placeholder="Parent / Guardian Full Name"
                    required={isMinor}
                    className="h-10 rounded-xl"
                  />
                  <Input
                    type="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    placeholder="Parent 10-digit Mobile"
                    required={isMinor}
                    className="h-10 rounded-xl"
                  />
                </div>
              )}
            </div>

            {/* Explicit Intent Confirmation */}
            <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmIntent}
                onChange={(e) => setConfirmIntent(e.target.checked)}
                required
                className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-slate-800 leading-relaxed">
                <strong className="flex items-center gap-1 text-slate-950">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  Explicit Admission Intent Declaration
                </strong>
                I genuinely intend to enroll in this batch if our cohort receives a matching offer,
                and understand AcademyFind charges <strong>₹0 booking advance</strong>.
              </span>
            </label>

            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="rounded-full h-11 px-5"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !confirmIntent || !selectedBatchId}
                className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold h-11 px-6 shadow-md shadow-amber-500/20"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Launching Cohort...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Launch BatchBuy Cohort
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
