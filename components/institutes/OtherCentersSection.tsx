"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  MapPin,
  Star,
  ArrowRight,
  Network,
  Sparkles,
  Search,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VerifiedBadge } from "@/components/institutes/VerifiedBadge";

export interface SiblingCenter {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  imageUrl: string | null;
  address: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  isVerified: boolean;
  cityName: string;
  categoryName?: string;
  hubNames: string[];
}

interface OtherCentersSectionProps {
  currentInstituteName: string;
  centers: SiblingCenter[];
  hubNames: string[];
}

export function OtherCentersSection({
  currentInstituteName,
  centers,
  hubNames,
}: OtherCentersSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  if (!centers || centers.length === 0) {
    return null;
  }

  // Preview up to 4 centers directly in the grid
  const previewCenters = centers.slice(0, 4);
  const remainingCount = centers.length - 4;

  const filteredModalCenters = centers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      c.cityName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      c.address?.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <section className="relative mt-16 pt-12 border-t border-slate-200">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-700 border border-amber-500/20">
              <Network className="w-5 h-5" />
            </span>
            <span className="text-xs font-black uppercase tracking-widest text-amber-800 bg-amber-100/80 px-2.5 py-0.5 rounded-full border border-amber-200">
              Official Branch Network
            </span>
          </div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Visit Our Other Centers
          </h2>
          <p className="mt-1.5 text-slate-600 text-sm max-w-2xl">
            Explore sister branches and affiliated centers of{" "}
            <span className="font-semibold text-slate-800">{currentInstituteName}</span> across different cities.
          </p>

          {hubNames.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              {hubNames.map((name, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-700 bg-stone-100 px-2.5 py-0.5 rounded-lg border border-stone-200/80"
                >
                  <Sparkles className="w-3 h-3 text-amber-500 fill-amber-400" />
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>

        {centers.length > 4 && (
          <Button
            onClick={() => setModalOpen(true)}
            variant="outline"
            className="rounded-2xl border-amber-300 bg-amber-50/60 hover:bg-amber-100/80 text-amber-900 font-bold text-xs h-10 px-4 flex items-center gap-2 transition-all hover:scale-[1.02] shadow-xs self-start sm:self-auto"
          >
            <span>Explore All {centers.length} Centers</span>
            <ArrowRight className="w-4 h-4 text-amber-700" />
          </Button>
        )}
      </div>

      {/* Grid of 3-4 Centers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {previewCenters.map((center) => {
          const displayImage =
            center.imageUrl || center.logo || "/no_image/coaching_inst.PNG";
          const centerUrl = `/institute/${center.id}-${center.slug}`;

          return (
            <Link
              key={center.id}
              href={centerUrl}
              className="group flex flex-col rounded-3xl border border-slate-200/90 bg-white overflow-hidden shadow-sm hover:shadow-2xl hover:border-amber-300 hover:-translate-y-1.5 transition-all duration-300"
            >
              <div className="aspect-[16/10] w-full overflow-hidden bg-slate-100 relative">
                <img
                  src={displayImage}
                  alt={center.name}
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                />

                {center.isVerified && (
                  <div className="absolute top-3 left-3 z-10">
                    <VerifiedBadge variant="card" showTooltip={false} />
                  </div>
                )}

                <div className="absolute bottom-2.5 right-2.5 z-10 bg-slate-900/80 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-amber-400" />
                  {center.cityName}
                </div>
              </div>

              <div className="p-5 flex flex-col flex-1">
                {center.categoryName && (
                  <div className="mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60 line-clamp-1">
                      {center.categoryName}
                    </span>
                  </div>
                )}

                <h3 className="font-extrabold text-slate-900 text-base line-clamp-1 group-hover:text-amber-600 transition-colors">
                  {center.name}
                </h3>

                <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed flex items-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>{center.address || center.cityName}</span>
                </p>

                <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100">
                  <div className="flex items-center gap-1 bg-amber-50/70 border border-amber-100 px-2 py-0.5 rounded-lg">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-bold text-slate-800">
                      {center.googleRating && center.googleRating > 0
                        ? center.googleRating
                        : "New"}
                    </span>
                    {center.googleReviewCount ? (
                      <span className="text-[10px] text-slate-400">
                        ({center.googleReviewCount})
                      </span>
                    ) : null}
                  </div>

                  <span className="text-xs font-bold text-amber-700 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Visit Branch
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* "Explore All" Full Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border-slate-200 bg-white/95 backdrop-blur-xl shadow-2xl p-6 sm:p-8">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 flex items-center justify-center shrink-0">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">
                  All Branch Centers
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Explore all {centers.length} affiliated branches and centers of {currentInstituteName}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Search bar inside modal */}
          <div className="relative mt-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search branch centers by name, city, or address..."
              className="pl-10 h-10 text-sm rounded-xl border-slate-200 focus:border-amber-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {filteredModalCenters.length === 0 ? (
              <div className="col-span-full py-12 text-center text-sm text-slate-500">
                No centers found matching "{searchFilter}".
              </div>
            ) : (
              filteredModalCenters.map((center) => {
                const displayImage =
                  center.imageUrl || center.logo || "/no_image/coaching_inst.PNG";
                const centerUrl = `/institute/${center.id}-${center.slug}`;

                return (
                  <Link
                    key={center.id}
                    href={centerUrl}
                    onClick={() => setModalOpen(false)}
                    className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-slate-200/80 bg-white hover:border-amber-400 hover:shadow-md transition-all group"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative">
                      <Image
                        src={displayImage}
                        alt={center.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-sm truncate group-hover:text-amber-700 transition-colors">
                          {center.name}
                        </h4>
                        {center.isVerified && (
                          <VerifiedBadge variant="card" showTooltip={false} />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{center.cityName}</span>
                      </p>
                      {center.categoryName && (
                        <span className="inline-block text-[10px] font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200/60 mt-1">
                          {center.categoryName}
                        </span>
                      )}
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 text-slate-400 group-hover:bg-amber-100 group-hover:text-amber-800 transition-colors shrink-0">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
