import { getAdminBatchBuyReconciliationWorkspace } from "@/lib/batchbuy/redemptionQueries";
import { AdminBatchBuyClient } from "./AdminBatchBuyClient";

export const dynamic = "force-dynamic";

export default async function AdminBatchBuyPage() {
  const workspace = await getAdminBatchBuyReconciliationWorkspace();

  if (!workspace.success) {
    return (
      <div className="p-8 text-center bg-red-50 rounded-2xl border border-red-200 text-red-700">
        <h2 className="text-lg font-bold">Admin Access Required</h2>
        <p className="mt-1 text-sm">{workspace.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="pb-6 border-b border-stone-200">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold mb-2">
          <span>BatchBuy™ Commercial Governance</span>
          <span>•</span>
          <span>Agreements · Anti-Bypass · B2B GST Ledger</span>
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-stone-900 tracking-tight">
          BatchBuy Reconciliation &amp; Commission Control
        </h1>
        <p className="mt-1 text-sm text-stone-600 max-w-3xl">
          Manage versioned 2%/3%/4% commercial agreements, adjudicate CRM anti-bypass flags,
          mature 15-day commercial cooling-off holds, and issue GST-segregated B2B commission
          invoices.
        </p>
      </div>

      <AdminBatchBuyClient
        institutes={workspace.institutes}
        agreements={workspace.agreements}
        attributions={workspace.attributions}
        ledgerEntries={workspace.ledgerEntries}
        invoices={workspace.invoices}
        creditNotes={workspace.creditNotes}
        auditLogs={workspace.auditLogs}
      />
    </div>
  );
}
