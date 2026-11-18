import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getInstituteDiscountSlabs } from "@/lib/batchbuy/slabActions";
import { BatchBuySlabsManager } from "./BatchBuySlabsManager";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "BatchBuy Discount Slabs | Manager Dashboard",
  description: "Configure collective bargaining and group admission discount tiers.",
};

type Props = {
  params: Promise<{ instituteId: string }>;
};

export default async function BatchBuySlabsPage({ params }: Props) {
  const { instituteId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  // 1. Fetch Institute Details
  const institute = await prisma.institute.findUnique({
    where: { id: instituteId },
    select: {
      id: true,
      name: true,
      slug: true,
      city: { select: { name: true } },
    },
  });

  if (!institute) {
    notFound();
  }

  // 2. Fetch Slabs and Batches
  const slabsData = await getInstituteDiscountSlabs(instituteId);

  if (!slabsData.success) {
    return (
      <div className="p-8 text-center bg-red-50 rounded-2xl border border-red-200 text-red-700">
        <h2 className="text-lg font-bold">Access or Loading Error</h2>
        <p className="mt-1 text-sm">{slabsData.error || "Unable to load discount slabs."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold mb-2">
            <span>⚡ BatchBuy™ Admissions</span>
            <span>•</span>
            <span>Slice 1 Active</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-stone-900 tracking-tight">
            Group Discount Slabs
          </h1>
          <p className="mt-1 text-sm text-stone-600 max-w-2xl">
            Configure volume discount tiers for cohorts of students joining {institute.name}. 
            Tiers unlock automatically when verified student cohorts reach qualifying group sizes.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full bg-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-xs">
            Discount Slabs
          </span>
          <Link
            href={`/manager/${instituteId}/batchbuy/offers`}
            className="rounded-full border border-stone-200 bg-white hover:bg-stone-50 px-4 py-2 text-xs font-bold text-stone-700 transition-colors"
          >
            Cohort Offers
          </Link>
        </div>
      </div>

      {/* Interactive Slab Configurator */}
      <BatchBuySlabsManager
        instituteId={institute.id}
        instituteName={institute.name}
        initialSlabs={slabsData.slabs}
        batches={slabsData.batches}
      />
    </div>
  );
}
