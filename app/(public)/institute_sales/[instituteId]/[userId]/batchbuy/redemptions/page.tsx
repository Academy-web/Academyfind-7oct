import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth/auth";
import { getInstituteRedemptionWorkspace } from "@/lib/batchbuy/redemptionQueries";
import { RedemptionWorkspaceClient } from "@/components/batchbuy/RedemptionWorkspaceClient";

export const metadata: Metadata = {
  title: "BatchBuy Voucher Redemption | Sales Counter",
  description:
    "Verify and redeem student BatchBuy vouchers at the center counter.",
};

type Props = {
  params: Promise<{ instituteId: string; userId: string }>;
};

export default async function IsmBatchBuyRedemptionsPage({ params }: Props) {
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
        <h2 className="text-lg font-bold">Counter Access Error</h2>
        <p className="mt-1 text-sm">{workspace.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-stone-200">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold mb-2">
          <span>BatchBuy™ Counter Desk</span>
          <span>•</span>
          <span>Single-Use QR Check-In</span>
        </div>
        <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight">
          BatchBuy Voucher Redemption
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Verify student BatchBuy passes for {workspace.institute.name} and convert directly into
          official admissions.
        </p>
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
