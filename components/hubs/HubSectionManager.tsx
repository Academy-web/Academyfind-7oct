"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Network,
  Building2,
  MapPin,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { CreateHubDialog } from "@/components/hubs/CreateHubDialog";
import { EditHubDialog, HubDetails } from "@/components/hubs/EditHubDialog";
import { ManagedInstituteOption } from "@/app/(public)/manager/hubs/actions";

export interface HubWithMembers {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  createdAt: Date | string;
  institutes: {
    institute: {
      id: string;
      name: string;
      slug: string;
      logo: string | null;
      imageUrl: string | null;
      city: { name: string } | null;
    };
  }[];
}

interface HubSectionManagerProps {
  hubs: HubWithMembers[];
  managedInstitutes: ManagedInstituteOption[];
  currentInstituteId?: string; // If viewing inside an institute dashboard
  currentUserId: string;
}

export function HubSectionManager({
  hubs,
  managedInstitutes,
  currentInstituteId,
  currentUserId,
}: HubSectionManagerProps) {
  // If inside a specific institute dashboard, we might want to highlight hubs this institute is part of
  const relevantHubs = currentInstituteId
    ? hubs.filter((h) =>
        h.institutes.some((i) => i.institute.id === currentInstituteId)
      )
    : hubs;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-amber-500/10 text-amber-700 border border-amber-500/20">
              <Network className="w-5 h-5" />
            </span>
            <h2 className="text-2xl font-black text-stone-900 tracking-tight">
              {currentInstituteId
                ? "Connected Hubs & Branch Network"
                : "Network Hubs & Centers"}
            </h2>
          </div>
          <p className="text-stone-500 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
            {currentInstituteId
              ? "All branch networks this center is linked to. Visitors on this institute's public page will see 'Visit Our Other Centers'."
              : "Link multiple centers under one brand network. When students view any center's public page, they can easily explore your other branches."}
          </p>
        </div>

        <CreateHubDialog
          managedInstitutes={managedInstitutes}
          preselectedInstituteId={currentInstituteId}
        />
      </div>

      {relevantHubs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-amber-300/80 bg-gradient-to-br from-amber-50/40 via-white to-orange-50/20 p-8 text-center space-y-4 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 flex items-center justify-center mx-auto">
            <Network className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-bold text-stone-900 text-base">
              {currentInstituteId
                ? "No Hubs Linked Yet"
                : "Create Your First Network Hub"}
            </h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              {currentInstituteId
                ? "Connect this center with your other institutes so students visiting its public page can explore your other branches across the city or country."
                : "Do you have 2 or more centers? Group them into a hub to display 'Visit Our Other Centers' on every center's public page."}
            </p>
          </div>
          <CreateHubDialog
            managedInstitutes={managedInstitutes}
            preselectedInstituteId={currentInstituteId}
            triggerButton={
              <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-stone-950 font-bold text-xs shadow-md transition-all hover:scale-[1.02]">
                <Sparkles className="w-3.5 h-3.5 fill-stone-950" />
                <span>Link Centers Into A Hub</span>
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {relevantHubs.map((hub) => {
            const isCreator = hub.createdById === currentUserId;
            const hubDetailData: HubDetails = {
              id: hub.id,
              name: hub.name,
              description: hub.description,
              createdById: hub.createdById,
              memberInstituteIds: hub.institutes.map((i) => i.institute.id),
            };

            return (
              <div
                key={hub.id}
                className="group relative rounded-3xl border border-stone-200/90 bg-white/90 backdrop-blur-md p-6 shadow-sm hover:shadow-xl hover:border-amber-300 transition-all duration-300 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-black text-lg text-stone-900 group-hover:text-amber-800 transition-colors">
                          {hub.name}
                        </h3>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/60 shrink-0">
                          {hub.institutes.length} Centers Linked
                        </span>
                      </div>
                      {hub.description && (
                        <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed">
                          {hub.description}
                        </p>
                      )}
                    </div>

                    {isCreator && (
                      <EditHubDialog
                        hub={hubDetailData}
                        managedInstitutes={managedInstitutes}
                      />
                    )}
                  </div>

                  {/* Connected Centers List */}
                  <div className="space-y-2 pt-2 border-t border-stone-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      Connected Centers:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {hub.institutes.map(({ institute }) => {
                        const isCurrent = institute.id === currentInstituteId;
                        const displayImg = institute.imageUrl || institute.logo;

                        return (
                          <div
                            key={institute.id}
                            className={`flex items-center gap-2.5 p-2 rounded-xl border text-xs transition-colors ${
                              isCurrent
                                ? "bg-amber-500/10 border-amber-300"
                                : "bg-stone-50/70 border-stone-100 hover:bg-stone-100/70"
                            }`}
                          >
                            <div className="w-7 h-7 rounded-lg overflow-hidden bg-white border border-stone-200 shrink-0 relative">
                              {displayImg ? (
                                <Image
                                  src={displayImg}
                                  alt={institute.name}
                                  fill
                                  className="object-cover"
                                />
                              ) : (
                                <Building2 className="w-3.5 h-3.5 text-stone-400 m-auto mt-1.5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-stone-800 truncate text-[11px]">
                                {institute.name}
                              </p>
                              <p className="text-[10px] text-stone-500 truncate flex items-center gap-0.5">
                                <MapPin className="w-2.5 h-2.5 text-stone-400 shrink-0" />
                                {institute.city?.name || "Branch"}
                              </p>
                            </div>
                            <Link
                              href={`/institute/${institute.id}-${institute.slug}`}
                              target="_blank"
                              title="View Public Profile"
                              className="text-stone-400 hover:text-amber-700 p-1 shrink-0 transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-stone-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-stone-400">
                    Cross-promoted on each center's page
                  </span>

                  {hub.institutes[0] && (
                    <Link
                      href={`/institute/${hub.institutes[0].institute.id}-${hub.institutes[0].institute.slug}`}
                      target="_blank"
                      className="text-amber-700 hover:text-amber-800 font-bold flex items-center gap-1 group/link"
                    >
                      <span>Preview Live</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover/link:translate-x-0.5 transition-transform" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
