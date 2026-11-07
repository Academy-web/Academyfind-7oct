import { prisma } from "@/lib/prisma";
import { MapPin, AlertCircle } from "lucide-react";
import AddCityModal from "@/components/admin/AddCityModal";
import AdminCitiesTableClient from "@/components/admin/AdminCitiesTableClient";
import type { CityData } from "@/components/admin/EditCityModal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Operational Cities | Admin Center",
  description: "Manage operational cities, regions, and geographical distribution of institutes on AcademyFind.",
};

export default async function AdminCitiesPage() {
  let cities: CityData[] = [];
  let fetchError: string | null = null;

  try {
    // 🚀 Fetch all cities with institute counts safely
    const rawCities = await prisma.city.findMany({
      include: {
        _count: {
          select: { institutes: true },
        },
      },
      orderBy: [
        { name: "asc" },
        { state: "asc" },
      ],
    });

    // Cleanly sanitize and serialize data for the client boundary
    cities = rawCities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      state: c.state,
      country: c.country || "India",
      latitude: c.latitude,
      longitude: c.longitude,
      description: c.description,
      _count: {
        institutes: c._count?.institutes ?? 0,
      },
    }));
  } catch (err: any) {
    console.error("AdminCitiesPage fetch error:", err);
    fetchError = err?.message || "Failed to load operational cities from the database.";
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── HEADER SECTION ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-stone-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
              <MapPin className="w-6 h-6" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
              Operational Cities
            </h1>
          </div>
          <p className="text-stone-500 text-sm mt-1.5 ml-1">
            Manage regions, directories, and geographic mapping of your institutes across India.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Add City Modal Trigger */}
          <AddCityModal />
        </div>
      </div>

      {/* ── ERROR RECOVERY BANNER (IF DB FETCH FAILS) ── */}
      {fetchError && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold">Database Notice</p>
            <p className="text-xs text-amber-800 mt-0.5">{fetchError}</p>
            <p className="text-xs text-stone-600 mt-1">
              Please refresh or check the database connection if this persists.
            </p>
          </div>
        </div>
      )}

      {/* ── INTERACTIVE CLIENT TABLE WITH SEARCH & STATS ── */}
      <AdminCitiesTableClient initialCities={cities} />
    </div>
  );
}
