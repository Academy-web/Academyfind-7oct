import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
import { getInstituteBatchBuyOffersData } from "@/lib/batchbuy/offerQueries";
import { BatchBuyOffersManager } from "./BatchBuyOffersManager";

export const metadata: Metadata = {
  title: "BatchBuy Cohort Offers | Manager Dashboard",
  description:
    "Publish immutable versioned group fee offers, configure dual acceptance and admission quorums, and track voucher issuance.",
};

type Props = {
  params: Promise<{ instituteId: string }>;
};

export default async function BatchBuyOffersPage({ params }: Props) {
  const { instituteId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  const institute = await prisma.institute.findUnique({
    where: { id: instituteId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!institute) {
    notFound();
  }

  const data = await getInstituteBatchBuyOffersData(instituteId);

  if (!data.success) {
    return (
      <div className="p-8 text-center bg-red-50 rounded-2xl border border-red-200 text-red-700">
        <h2 className="text-lg font-bold">Access or Loading Error</h2>
        <p className="mt-1 text-sm">{data.error || "Unable to load cohort offers."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header + Cross-Nav */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold mb-2">
            <span>BatchBuy™ Admissions</span>
            <span>•</span>
            <span>Versioned Offers &amp; Vouchers</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-stone-900 tracking-tight">
            Cohort Offers &amp; Quorum Control
          </h1>
          <p className="mt-1 text-sm text-stone-600 max-w-2xl">
            Publish locked, versioned group offers for cohorts targeting {institute.name}. Track
            individual student acceptances and center admission quorums separately.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/manager/${instituteId}/batchbuy/slabs`}
            className="rounded-full border border-stone-200 bg-white hover:bg-stone-50 px-4 py-2 text-xs font-bold text-stone-700 transition-colors"
          >
            Discount Slabs
          </Link>
          <span className="rounded-full bg-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-xs">
            Cohort Offers
          </span>
          <Link
            href={`/manager/${instituteId}/batchbuy/redemptions`}
            className="rounded-full border border-stone-200 bg-white hover:bg-amber-50 hover:border-amber-300 px-4 py-2 text-xs font-bold text-stone-700 transition-colors"
          >
            Counter Redemption &amp; Ledger
          </Link>
        </div>
      </div>

      <BatchBuyOffersManager
        instituteId={institute.id}
        instituteName={institute.name}
        cohorts={data.cohorts}
        agreementsSummary={data.agreementsSummary}
      />
    </div>
  );
}
