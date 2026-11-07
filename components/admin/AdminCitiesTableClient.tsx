"use client";

import { useState, useMemo } from "react";
import { MapPin, Map, Search, Building2, SlidersHorizontal, ArrowUpDown, X } from "lucide-react";
import EditCityModal, { CityData } from "@/components/admin/EditCityModal";

interface AdminCitiesTableClientProps {
  initialCities: CityData[];
}

type SortOption = "name-asc" | "name-desc" | "institutes-desc" | "institutes-asc" | "state-asc";

export default function AdminCitiesTableClient({ initialCities }: AdminCitiesTableClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("institutes-desc");

  // Extract unique states for filtering
  const availableStates = useMemo(() => {
    const states = Array.from(new Set(initialCities.map((c) => c.state).filter(Boolean)));
    return states.sort((a, b) => a.localeCompare(b));
  }, [initialCities]);

  // Aggregate stats
  const totalInstitutes = useMemo(() => {
    return initialCities.reduce((sum, c) => sum + (c._count?.institutes ?? 0), 0);
  }, [initialCities]);

  const activeHubs = useMemo(() => {
    return initialCities.filter((c) => (c._count?.institutes ?? 0) > 0).length;
  }, [initialCities]);

  // Filter and sort cities
  const filteredCities = useMemo(() => {
    return initialCities
      .filter((city) => {
        const query = searchQuery.trim().toLowerCase();
        const matchesQuery =
          !query ||
          city.name.toLowerCase().includes(query) ||
          city.slug.toLowerCase().includes(query) ||
          city.state.toLowerCase().includes(query) ||
          (city.country && city.country.toLowerCase().includes(query));

        const matchesState = selectedState === "ALL" || city.state === selectedState;

        return matchesQuery && matchesState;
      })
      .sort((a, b) => {
        if (sortBy === "name-asc") return a.name.localeCompare(b.name);
        if (sortBy === "name-desc") return b.name.localeCompare(a.name);
        if (sortBy === "institutes-desc") {
          return (b._count?.institutes ?? 0) - (a._count?.institutes ?? 0);
        }
        if (sortBy === "institutes-asc") {
          return (a._count?.institutes ?? 0) - (b._count?.institutes ?? 0);
        }
        if (sortBy === "state-asc") return a.state.localeCompare(b.state);
        return 0;
      });
  }, [initialCities, searchQuery, selectedState, sortBy]);

  return (
    <div className="space-y-6">
      {/* ── METRIC STATS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white/80 backdrop-blur-xl border border-stone-200/80 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Total Cities</p>
              <h3 className="text-2xl font-black text-stone-900">{initialCities.length}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-xl border border-stone-200/80 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Total Institutes</p>
              <h3 className="text-2xl font-black text-stone-900">{totalInstitutes.toLocaleString("en-IN")}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-xl border border-stone-200/80 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
              <Map className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Active Hubs</p>
              <h3 className="text-2xl font-black text-stone-900">{activeHubs} <span className="text-xs text-stone-400 font-normal">/ {initialCities.length}</span></h3>
            </div>
          </div>
        </div>
      </div>

      {/* ── FILTER & SEARCH BAR ── */}
      <div className="bg-white/90 backdrop-blur-xl border border-stone-200/80 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by city name, state, or slug..."
            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-stone-200 bg-stone-50/70 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm text-stone-900 font-medium transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* State Filter & Sorting Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* State Select */}
          <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-stone-500" />
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="bg-transparent text-stone-800 font-semibold outline-none cursor-pointer"
            >
              <option value="ALL">All States ({availableStates.length})</option>
              {availableStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Select */}
          <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-stone-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-transparent text-stone-800 font-semibold outline-none cursor-pointer"
            >
              <option value="institutes-desc">Most Institutes</option>
              <option value="institutes-asc">Fewest Institutes</option>
              <option value="name-asc">City: A to Z</option>
              <option value="name-desc">City: Z to A</option>
              <option value="state-asc">State: A to Z</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── CITIES TABLE ── */}
      <div className="bg-white/90 backdrop-blur-xl border border-stone-200/80 rounded-3xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-sm text-left">
            <thead className="bg-stone-50/80 text-stone-600 font-semibold border-b border-stone-200 text-xs uppercase tracking-wider">
              <tr>
                <th className="p-4">City Name & Slug</th>
                <th className="p-4">State & Country</th>
                <th className="p-4 text-center">Institutes Listed</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredCities.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
                        <MapPin className="w-6 h-6" />
                      </div>
                      <p className="text-base font-bold text-stone-800">No matching cities found</p>
                      <p className="text-xs text-stone-500 max-w-sm">
                        {searchQuery || selectedState !== "ALL"
                          ? "Try adjusting your search keywords or state filters to view registered cities."
                          : "No operational cities exist in the database yet."}
                      </p>
                      {(searchQuery || selectedState !== "ALL") && (
                        <button
                          onClick={() => {
                            setSearchQuery("");
                            setSelectedState("ALL");
                          }}
                          className="text-xs font-bold text-amber-600 hover:text-amber-700 underline cursor-pointer mt-1"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCities.map((city) => {
                  const count = city._count?.institutes ?? 0;
                  return (
                    <tr
                      key={city.id}
                      className="hover:bg-amber-50/30 transition-colors group"
                    >
                      {/* 1. Name & Slug */}
                      <td className="p-4">
                        <div className="font-bold text-stone-900 flex items-center gap-2 text-base">
                          <MapPin className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
                          <span>{city.name}</span>
                        </div>
                        <div className="text-[11px] text-stone-500 mt-1 font-mono bg-stone-100 inline-block px-2 py-0.5 rounded-md border border-stone-200/60">
                          /directory/{city.slug}
                        </div>
                      </td>

                      {/* 2. State & Country */}
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 font-semibold text-stone-800">
                          <Map className="w-3.5 h-3.5 text-stone-400" /> {city.state}
                        </div>
                        <div className="text-[11px] text-stone-500 mt-1 uppercase tracking-wider font-semibold ml-5">
                          {city.country || "India"}
                        </div>
                      </td>

                      {/* 3. Listed Institutes Count */}
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <span
                            className={`inline-flex items-center justify-center min-w-[2.25rem] px-2.5 h-7 rounded-full text-xs font-extrabold ${
                              count > 0
                                ? "bg-amber-100 text-amber-900 border border-amber-200/80"
                                : "bg-stone-100 text-stone-500 border border-stone-200/60"
                            }`}
                          >
                            {count.toLocaleString("en-IN")}
                          </span>
                          {count > 0 && (
                            <span className="text-[10px] text-stone-400 mt-0.5 font-medium">Institutes</span>
                          )}
                        </div>
                      </td>

                      {/* 4. Action Buttons */}
                      <td className="p-4 text-right">
                        <EditCityModal city={city} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
