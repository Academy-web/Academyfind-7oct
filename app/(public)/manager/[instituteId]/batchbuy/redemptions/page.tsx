import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth/auth";
import { getInstituteRedemptionWorkspace } from "@/lib/batchbuy/redemptionQueries";
import { RedemptionWorkspaceClient } from "@/components/batchbuy/RedemptionWorkspaceClient";

export const metadata: Metadata = {
  title: "BatchBuy Counter Redemption & Commission Ledger | Manager Dashboard",
  description:
    "Verify student BatchBuy admission vouchers, manage two-stage admission quorum settlement, and view B2B commission & GST invoices.",
};

type Props = {
  params: Promise<{ instituteId: string }>;
};

export default async function ManagerBatchBuyRedemptionsPage({ params }: Props) {
  const { instituteId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) {
    redirect("/login");
  }

  const workspace = await getInstituteRedemptionWorkspace(instituteId);

  if (!workspace.success) {
    return (
      <div className="p-8 text-center bg-red-50 rounded-2xl border border-red-200 text-red-700">
        <h2 className="text-lg font-bold">Access or Loading Error</h2>
        <p className="mt-1 text-sm">{workspace.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold mb-2">
            <span>BatchBuy™ Settlement</span>
            <span>•</span>
            <span>Center Redemption &amp; B2B Ledger</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-stone-900 tracking-tight">
            Counter Redemption &amp; Commission Ledger
          </h1>
          <p className="mt-1 text-sm text-stone-600 max-w-2xl">
            Verify QR vouchers for {workspace.institute.name}, evaluate admission quorums cleanly,
            and track 15-day cooling-off commissions &amp; GST-segregated invoices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/manager/${instituteId}/batchbuy/slabs`}
            className="rounded-full border border-stone-200 bg-white hover:bg-stone-50 px-4 py-2 text-xs font-bold text-stone-700 transition-colors"
          >
            Discount Slabs
          </Link>
          <Link
            href={`/manager/${instituteId}/batchbuy/offers`}
            className="rounded-full border border-stone-200 bg-white hover:bg-stone-50 px-4 py-2 text-xs font-bold text-stone-700 transition-colors"
          >
            Cohort Offers
          </Link>
          <span className="rounded-full bg-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-xs">
            Redemptions &amp; Ledger
          </span>
        </div>
      </div>

      <RedemptionWorkspaceClient
        instituteId={workspace.institute.id}
        instituteName={workspace.institute.name}
        actorRole={workspace.actor.role}
        isIsmRole={workspace.actor.isIsmRole}
        agreementsSummary={workspace.agreementsSummary}
        vouchers={workspace.vouchers}
        offersForQuorumSettlement={workspace.offersForQuorumSettlement}
        attributions={workspace.attributions}
        invoices={workspace.invoices}
        creditNotes={workspace.creditNotes}
        auditLogs={workspace.auditLogs}
      />
    </div>
  );
}
