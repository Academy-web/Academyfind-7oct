"use client";

import React, { useState, useMemo, useTransition } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Calculator,
  ShieldCheck,
  Tag,
  Building2,
  PackageOpen,
  ArrowRight,
  Info,
  RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  SerializedDiscountSlab,
  saveInstituteDiscountSlabs,
} from "@/lib/batchbuy/slabActions";
import {
  SingleSlabInput,
  validateSlabRangesAndTiers,
  SlabFallbackPolicyType,
} from "@/lib/batchbuy/slabValidation";

interface BatchOption {
  id: string;
  name: string;
  courseName: string | null;
  academicYear: string | null;
  fee: number | null;
}

interface BatchBuySlabsManagerProps {
  instituteId: string;
  instituteName: string;
  initialSlabs: SerializedDiscountSlab[];
  batches: BatchOption[];
}

const DEFAULT_PERK_SUGGESTIONS = [
  "Free All India Test Series",
  "Study Material Module Pack",
  "Hostel Fee Concession",
  "Registration Fee Waiver",
  "Free Doubt-Solving App Access",
  "Formula Booklets & T-Shirt",
];

const RECOMMENDED_DEFAULT_SLABS: SingleSlabInput[] = [
  {
    minStudents: 5,
    maxStudents: 9,
    discountPercentage: 8.0,
    waiveRegistration: true,
    includedPerks: ["Free All India Test Series"],
    fallbackPolicy: "ABSORB_SHORTFALL",
    notes: "Tier 1: Starter cohort discount",
    isActive: true,
  },
  {
    minStudents: 10,
    maxStudents: 19,
    discountPercentage: 12.0,
    waiveRegistration: true,
    includedPerks: ["Free All India Test Series", "Study Material Module Pack"],
    fallbackPolicy: "ABSORB_SHORTFALL",
    notes: "Tier 2: Standard volume cohort discount",
    isActive: true,
  },
  {
    minStudents: 20,
    maxStudents: null,
    discountPercentage: 16.0,
    waiveRegistration: true,
    includedPerks: [
      "Free All India Test Series",
      "Study Material Module Pack",
      "Hostel Fee Concession",
    ],
    fallbackPolicy: "ABSORB_SHORTFALL",
    notes: "Tier 3: Maximum volume cohort tier",
    isActive: true,
  },
];

export function BatchBuySlabsManager({
  instituteId,
  instituteName,
  initialSlabs,
  batches,
}: BatchBuySlabsManagerProps) {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Active slabs for the selected scope (institute-wide vs batch-specific)
  const currentScopeSlabs = useMemo(() => {
    return initialSlabs.filter((s) => s.batchId === selectedBatchId);
  }, [initialSlabs, selectedBatchId]);

  // Working state for the editor
  const [slabs, setSlabs] = useState<SingleSlabInput[]>(() => {
    if (currentScopeSlabs.length > 0) {
      return currentScopeSlabs.map((s) => ({
        id: s.id,
        minStudents: s.minStudents,
        maxStudents: s.maxStudents,
        discountPercentage: s.discountPercentage,
        waiveRegistration: s.waiveRegistration,
        includedPerks: s.includedPerks,
        fallbackPolicy: s.fallbackPolicy,
        notes: s.notes,
        isActive: s.isActive,
      }));
    }
    return RECOMMENDED_DEFAULT_SLABS;
  });

  // Whenever user switches scope, reload working state
  const handleScopeChange = (newBatchId: string | null) => {
    setSelectedBatchId(newBatchId);
    const matched = initialSlabs.filter((s) => s.batchId === newBatchId);
    if (matched.length > 0) {
      setSlabs(
        matched.map((s) => ({
          id: s.id,
          minStudents: s.minStudents,
          maxStudents: s.maxStudents,
          discountPercentage: s.discountPercentage,
          waiveRegistration: s.waiveRegistration,
          includedPerks: s.includedPerks,
          fallbackPolicy: s.fallbackPolicy,
          notes: s.notes,
          isActive: s.isActive,
        }))
      );
    } else {
      setSlabs(RECOMMENDED_DEFAULT_SLABS);
    }
  };

  // Real-time validation
  const validationError = useMemo(() => {
    try {
      validateSlabRangesAndTiers(slabs);
      return null;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : "Validation error";
    }
  }, [slabs]);

  // Live simulation calculator state
  const [simulatedFee, setSimulatedFee] = useState<number>(120000);
  const selectedBatchObj = batches.find((b) => b.id === selectedBatchId);

  // Add new tier automatically setting next non-overlapping minStudents
  const handleAddTier = () => {
    const active = slabs.filter((s) => s.isActive);
    let nextMin = 5;
    if (active.length > 0) {
      const highest = [...active].sort((a, b) => a.minStudents - b.minStudents)[
        active.length - 1
      ];
      nextMin = (highest.maxStudents ?? highest.minStudents) + 1;
    }

    setSlabs((prev) => [
      ...prev,
      {
        minStudents: nextMin,
        maxStudents: nextMin + 4,
        discountPercentage: Math.min(
          50,
          (prev[prev.length - 1]?.discountPercentage ?? 8) + 4
        ),
        waiveRegistration: true,
        includedPerks: [],
        fallbackPolicy: "ABSORB_SHORTFALL",
        notes: "",
        isActive: true,
      },
    ]);
  };

  // Remove tier
  const handleRemoveTier = (index: number) => {
    if (slabs.length <= 1) {
      toast.error("At least one discount slab tier must remain.");
      return;
    }
    setSlabs((prev) => prev.filter((_, i) => i !== index));
  };

  // Update specific tier field
  const handleUpdateTier = <K extends keyof SingleSlabInput>(
    index: number,
    field: K,
    value: SingleSlabInput[K]
  ) => {
    setSlabs((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Toggle perk
  const handleTogglePerk = (index: number, perk: string) => {
    setSlabs((prev) => {
      const updated = [...prev];
      const currentPerks = updated[index].includedPerks || [];
      if (currentPerks.includes(perk)) {
        updated[index].includedPerks = currentPerks.filter((p) => p !== perk);
      } else {
        updated[index].includedPerks = [...currentPerks, perk];
      }
      return updated;
    });
  };

  // Reset to recommendations
  const handleResetDefaults = () => {
    setSlabs(RECOMMENDED_DEFAULT_SLABS);
    toast.success("Reset to recommended discount slab configuration.");
  };

  // Save Slabs
  const handleSave = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    startTransition(async () => {
      const res = await saveInstituteDiscountSlabs({
        instituteId,
        batchId: selectedBatchId,
        slabs,
      });

      if (res.success) {
        toast.success(res.message || "Discount slabs saved successfully!");
      } else {
        toast.error(res.error || "Failed to save discount slabs.");
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Scope Selector Bar */}
      <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-stone-200 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
            {selectedBatchId ? (
              <PackageOpen className="w-5 h-5 text-amber-600" />
            ) : (
              <Building2 className="w-5 h-5 text-amber-600" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold text-stone-900">
              Slab Configuration Scope
            </h3>
            <p className="text-xs text-stone-500">
              {selectedBatchId
                ? `Custom override for "${selectedBatchObj?.name}"`
                : `Institute-wide baseline for all batches at ${instituteName}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedBatchId || ""}
            onChange={(e) => handleScopeChange(e.target.value || null)}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">🏢 Institute-Wide (Default Slabs)</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                📦 Batch Override: {b.name} ({b.academicYear || "Current"})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 transition-colors"
            title="Load recommended tiers"
          >
            <RotateCcw className="w-3.5 h-3.5 text-stone-500" />
            Recommended Template
          </button>
        </div>
      </div>

      {/* Validation Warning Alert */}
      {validationError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">Configuration Issue:</span>{" "}
            {validationError}
          </div>
        </div>
      )}

      {/* Tiers List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold text-stone-900">
              Volume Discount Tiers
            </h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {slabs.filter((s) => s.isActive).length} Active Tiers
            </span>
          </div>

          <button
            type="button"
            onClick={handleAddTier}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4" />
            Add Volume Tier
          </button>
        </div>

        {/* Tier Cards */}
        <div className="space-y-4">
          {slabs.map((slab, index) => {
            const isOpenEnded = slab.maxStudents === null || slab.maxStudents === undefined;

            return (
              <div
                key={index}
                className={`rounded-2xl border transition-all ${
                  slab.isActive
                    ? "bg-white border-stone-200 shadow-sm"
                    : "bg-stone-50 border-stone-200 opacity-60"
                } p-5 space-y-4`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-500 text-white font-extrabold text-xs flex items-center justify-center">
                      {index + 1}
                    </span>
                    <h3 className="font-bold text-stone-900 text-sm">
                      Tier {index + 1}:{" "}
                      {isOpenEnded
                        ? `${slab.minStudents}+ Students`
                        : `${slab.minStudents}–${slab.maxStudents} Students`}
                    </h3>
                    <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {slab.discountPercentage}% OFF
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-600">
                      <input
                        type="checkbox"
                        checked={slab.isActive}
                        onChange={(e) =>
                          handleUpdateTier(index, "isActive", e.target.checked)
                        }
                        className="rounded border-stone-300 text-amber-500 focus:ring-amber-500 h-4 w-4"
                      />
                      Active
                    </label>

                    <button
                      type="button"
                      onClick={() => handleRemoveTier(index)}
                      className="text-stone-400 hover:text-red-600 transition-colors p-1"
                      title="Remove tier"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Input Controls Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Min Students */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Min Students Required
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={200}
                      value={slab.minStudents}
                      onChange={(e) =>
                        handleUpdateTier(
                          index,
                          "minStudents",
                          parseInt(e.target.value) || 2
                        )
                      }
                      className="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <span className="text-[10px] text-stone-400">
                      Minimum cohort size to unlock tier
                    </span>
                  </div>

                  {/* Max Students */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-stone-700">
                        Max Students
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-stone-500 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={isOpenEnded}
                          onChange={(e) =>
                            handleUpdateTier(
                              index,
                              "maxStudents",
                              e.target.checked ? null : slab.minStudents + 4
                            )
                          }
                          className="rounded border-stone-300 text-amber-500 focus:ring-amber-500 h-3 w-3"
                        />
                        Open-ended (+)
                      </label>
                    </div>

                    <input
                      type="number"
                      min={slab.minStudents}
                      max={500}
                      disabled={isOpenEnded}
                      value={slab.maxStudents ?? ""}
                      placeholder={isOpenEnded ? "No Upper Limit (∞)" : "Max pax"}
                      onChange={(e) =>
                        handleUpdateTier(
                          index,
                          "maxStudents",
                          e.target.value ? parseInt(e.target.value) : null
                        )
                      }
                      className={`w-full text-sm font-semibold px-3 py-2 rounded-xl border border-stone-200 ${
                        isOpenEnded
                          ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                          : "bg-stone-50 focus:bg-white"
                      } focus:outline-none focus:ring-2 focus:ring-amber-500`}
                    />
                    <span className="text-[10px] text-stone-400">
                      {isOpenEnded
                        ? "Applies to all group sizes above min"
                        : "Upper cap for this tier"}
                    </span>
                  </div>

                  {/* Discount Percentage */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Discount Percentage (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="50"
                        value={slab.discountPercentage}
                        onChange={(e) =>
                          handleUpdateTier(
                            index,
                            "discountPercentage",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-full text-sm font-bold text-amber-900 px-3 py-2 pr-8 rounded-xl border border-stone-200 bg-amber-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="absolute right-3 top-2.5 text-xs font-extrabold text-amber-700">
                        %
                      </span>
                    </div>
                    <span className="text-[10px] text-stone-400">
                      Capped at 50% max
                    </span>
                  </div>

                  {/* Fallback Policy Dropdown */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Shortfall Fallback Policy
                    </label>
                    <select
                      value={slab.fallbackPolicy}
                      onChange={(e) =>
                        handleUpdateTier(
                          index,
                          "fallbackPolicy",
                          e.target.value as SlabFallbackPolicyType
                        )
                      }
                      className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="ABSORB_SHORTFALL">
                        🟢 Institute Absorbs (Recommended)
                      </option>
                      <option value="REVERT_TO_LOWER_SLAB">
                        🟡 Revert to Lower Slab
                      </option>
                      <option value="CANCEL_DISCOUNT">
                        🔴 Strict Quorum (Cancel if short)
                      </option>
                    </select>
                    <span className="text-[10px] text-stone-400">
                      Disclosed to students before accepting
                    </span>
                  </div>
                </div>

                {/* Additional Perks & Benefits Selector */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-amber-600" />
                      Bundled Cohort Perks (Included with this tier):
                    </span>

                    <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={slab.waiveRegistration}
                        onChange={(e) =>
                          handleUpdateTier(
                            index,
                            "waiveRegistration",
                            e.target.checked
                          )
                        }
                        className="rounded border-stone-300 text-amber-500 focus:ring-amber-500 h-3.5 w-3.5"
                      />
                      Waive Registration Fee
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {DEFAULT_PERK_SUGGESTIONS.map((perk) => {
                      const isSelected = slab.includedPerks.includes(perk);
                      return (
                        <button
                          key={perk}
                          type="button"
                          onClick={() => handleTogglePerk(index, perk)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                            isSelected
                              ? "bg-amber-500 text-white border-amber-600 font-bold shadow-xs"
                              : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                          }`}
                        >
                          {isSelected ? "✓ " : "+ "}
                          {perk}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fallback Policy Disclosure Callout */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3 text-amber-900">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold">
            Consumer Transparency Policy (Compliance Standard):
          </p>
          <p className="text-amber-800 leading-relaxed">
            Per the Consumer Protection (E-Commerce) Rules and AcademyFind BatchBuy terms, your selected shortfall fallback policy (e.g., <em>Absorb Shortfall</em> vs. <em>Revert to Lower Slab</em>) will be transparently displayed on students&apos; vouchers prior to offer acceptance.
          </p>
        </div>
      </div>

      {/* Live Unit Economics Simulator */}
      <div className="bg-stone-900 text-white rounded-3xl p-6 lg:p-8 space-y-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Live Unit Economics Simulator
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-800 text-stone-300 border border-stone-700">
                  Illustrative Simulation
                </span>
              </h3>
              <p className="text-xs text-stone-400">
                Sample projection based on an illustrative 3% success fee assumption. Actual commercial commission rates are governed strictly by your signed Institute Master Services Agreement (MSA).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-300 font-semibold">
              Sample Course Fee:
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs font-bold text-stone-400">
                ₹
              </span>
              <input
                type="number"
                step="5000"
                min="10000"
                value={simulatedFee}
                onChange={(e) => setSimulatedFee(parseInt(e.target.value) || 0)}
                className="w-36 text-sm font-bold bg-stone-800 border border-stone-700 text-white pl-7 pr-3 py-1.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Simulator Breakdown Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-800 text-stone-400 font-semibold">
                <th className="pb-3">Volume Tier</th>
                <th className="pb-3">Discount</th>
                <th className="pb-3">Student Pays (Savings)</th>
                <th className="pb-3">Est. AF Fee (3% Illustrative*)</th>
                <th className="pb-3">Institute Realization</th>
                <th className="pb-3 text-right">Total Batch Cashflow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {slabs
                .filter((s) => s.isActive)
                .map((slab, i) => {
                  const discountPct = slab.discountPercentage;
                  const discountAmount = (simulatedFee * discountPct) / 100;
                  const studentPays = simulatedFee - discountAmount;
                  const afCommission = (studentPays * 3.0) / 100;
                  const instituteNetPerStudent = studentPays - afCommission;
                  const minTotalRevenue = instituteNetPerStudent * slab.minStudents;

                  return (
                    <tr key={i} className="hover:bg-stone-800/30 transition-colors">
                      <td className="py-3 font-bold text-white">
                        Tier {i + 1} ({slab.minStudents}
                        {slab.maxStudents ? `–${slab.maxStudents}` : "+"} pax)
                      </td>
                      <td className="py-3 text-emerald-400 font-extrabold">
                        {discountPct}% OFF
                      </td>
                      <td className="py-3 text-stone-200">
                        ₹{Math.round(studentPays).toLocaleString("en-IN")}{" "}
                        <span className="text-emerald-400 font-semibold">
                          (-₹{Math.round(discountAmount).toLocaleString("en-IN")})
                        </span>
                      </td>
                      <td className="py-3 text-stone-400">
                        ₹{Math.round(afCommission).toLocaleString("en-IN")}
                      </td>
                      <td className="py-3 text-amber-300 font-bold">
                        ₹{Math.round(instituteNetPerStudent).toLocaleString("en-IN")}
                      </td>
                      <td className="py-3 text-right font-extrabold text-white">
                        ₹{Math.round(minTotalRevenue).toLocaleString("en-IN")}{" "}
                        <span className="text-[10px] text-stone-400 block font-normal">
                          (min {slab.minStudents} admissions)
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-stone-400">
            *Illustrative estimate only (3% modeled for demonstration). Final commercial commission rates (e.g., 2%–4%) are governed solely by your signed AcademyFind Partner Agreement. Excludes applicable GST.
          </p>
        </div>
      </div>

      {/* Save Action Bar */}
      <div className="flex items-center justify-between pt-4 border-t border-stone-200">
        <p className="text-xs text-stone-500">
          Last saved: {new Date().toLocaleDateString("en-IN", { dateStyle: "medium" })}
        </p>

        <button
          type="button"
          disabled={isPending || !!validationError}
          onClick={handleSave}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-all ${
            validationError || isPending
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-amber-500 hover:bg-amber-600 text-white hover:scale-[1.02]"
          }`}
        >
          {isPending ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving Slabs...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Save Discount Slabs
            </>
          )}
        </button>
      </div>
    </div>
  );
}
