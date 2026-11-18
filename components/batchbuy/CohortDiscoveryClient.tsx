"use client";

import { useMemo, useState } from "react";
import { Filter, MapPin, PlusCircle, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicCohortCardDTO } from "@/lib/batchbuy/cohortQueries";
import { COHORT_EXAM_CATEGORIES } from "@/lib/batchbuy/cohortValidation";
import { CohortCard } from "./CohortCard";
import { CreateCohortModal } from "./CreateCohortModal";

interface CohortDiscoveryClientProps {
  initialCohorts: PublicCohortCardDTO[];
  isLoggedIn: boolean;
  accountPhoneVerified: boolean;
  profilePrefill?: {
    targetExam?: string | null;
    targetYear?: number | null;
    currentClass?: string | null;
  };
}

export function CohortDiscoveryClient({
  initialCohorts,
  isLoggedIn,
  accountPhoneVerified,
  profilePrefill,
}: CohortDiscoveryClientProps) {
  const [search, setSearch] = useState("");
  const [selectedExam, setSelectedExam] = useState<string>("ALL");
  const [selectedCity, setSelectedCity] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const availableCities = useMemo(() => {
    const cities = new Set<string>();
    initialCohorts.forEach((c) => {
      if (c.institute.cityName) cities.add(c.institute.cityName);
    });
    return Array.from(cities).sort();
  }, [initialCohorts]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    initialCohorts.forEach((c) => years.add(c.targetAcademicYear));
    return Array.from(years).sort((a, b) => a - b);
  }, [initialCohorts]);

  const filteredCohorts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialCohorts.filter((c) => {
      if (
        selectedExam !== "ALL" &&
        c.examCategory.toLowerCase() !== selectedExam.toLowerCase()
      ) {
        return false;
      }
      if (
        selectedCity !== "ALL" &&
        c.institute.cityName.toLowerCase() !== selectedCity.toLowerCase()
      ) {
        return false;
      }
      if (
        selectedYear !== "ALL" &&
        String(c.targetAcademicYear) !== selectedYear
      ) {
        return false;
      }
      if (q) {
        const haystack = [
          c.title,
          c.cohortCode,
          c.examCategory,
          c.institute.name,
          c.institute.cityName,
          c.batch.name,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [initialCohorts, search, selectedExam, selectedCity, selectedYear]);

  const hasActiveFilters =
    search.trim() !== "" ||
    selectedExam !== "ALL" ||
    selectedCity !== "ALL" ||
    selectedYear !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setSelectedExam("ALL");
    setSelectedCity("ALL");
    setSelectedYear("ALL");
  };

  return (
    <div className="space-y-8">
      {/* Control Bar */}
      <div className="rounded-3xl border border-amber-200/70 bg-white/85 backdrop-blur-md p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.03)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-2xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by institute, batch, city, or cohort code (e.g. BB-ALLEN-KOTA)..."
              className="pl-11 pr-10 h-12 rounded-2xl border-slate-200 bg-white text-sm font-medium focus:border-amber-400 focus:ring-amber-200"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
              <select
                aria-label="Filter by city"
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="h-11 rounded-full border border-slate-200 bg-white px-4 text-xs sm:text-sm font-semibold text-slate-700 focus:border-amber-400 focus:outline-none"
              >
                <option value="ALL">All Cities</option>
                {availableCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            <select
              aria-label="Filter by academic year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="h-11 rounded-full border border-slate-200 bg-white px-4 text-xs sm:text-sm font-semibold text-slate-700 focus:border-amber-400 focus:outline-none"
            >
              <option value="ALL">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr} Intake
                </option>
              ))}
            </select>

            <Button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-sm px-6 h-11 shadow-md shadow-amber-500/20 hover:shadow-lg hover:shadow-amber-500/30 transition-all hover:-translate-y-0.5"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Start a New Cohort
            </Button>
          </div>
        </div>

        {/* Exam Category Quick Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Exam:
          </span>
          <button
            type="button"
            onClick={() => setSelectedExam("ALL")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              selectedExam === "ALL"
                ? "bg-amber-500 text-white shadow-sm shadow-amber-500/25"
                : "bg-slate-100 text-slate-700 hover:bg-amber-50 hover:text-amber-800"
            }`}
          >
            All Exams ({initialCohorts.length})
          </button>
          {COHORT_EXAM_CATEGORIES.slice(0, 8).map((exam) => (
            <button
              key={exam}
              type="button"
              onClick={() => setSelectedExam(exam)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                selectedExam === exam
                  ? "bg-amber-500 text-white shadow-sm shadow-amber-500/25"
                  : "bg-slate-100 text-slate-700 hover:bg-amber-50 hover:text-amber-800"
              }`}
            >
              {exam}
            </button>
          ))}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Results Grid */}
      {filteredCohorts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCohorts.map((cohort) => (
            <CohortCard key={cohort.id} cohort={cohort} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-amber-300/80 bg-white/80 p-10 sm:p-14 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Users className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-lg font-extrabold text-slate-900">
              {hasActiveFilters
                ? "No matching BatchBuy cohorts found"
                : "Be the First to Launch a BatchBuy Cohort"}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {hasActiveFilters
                ? "Try clearing a filter or launch a new cohort for your target coaching batch in 60 seconds."
                : "Pick your dream coaching batch, share the cohort link on WhatsApp with fellow aspirants, and unlock group fee discounts together."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters} className="rounded-full h-11 px-5">
                Clear Filters
              </Button>
            )}
            <Button
              onClick={() => setCreateModalOpen(true)}
              className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold h-11 px-6 shadow-md shadow-amber-500/20"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Start a Cohort Now
            </Button>
          </div>
        </div>
      )}

      <CreateCohortModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        isLoggedIn={isLoggedIn}
        accountPhoneVerified={accountPhoneVerified}
        profilePrefill={profilePrefill}
        callbackPath="/batchbuy"
      />
    </div>
  );
}
