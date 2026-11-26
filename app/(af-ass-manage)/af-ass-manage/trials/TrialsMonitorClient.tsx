"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  Plus,
  Search,
  IndianRupee,
  MousePointerClick,
  Mail,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrialRow {
  id: string;
  instituteId: string;
  source: string;
  status: string;
  campaignBatchId: string | null;
  recipientEmail: string | null;
  emailSentAt: string | null;
  emailDeliveredAt: string | null;
  emailBouncedAt: string | null;
  linkAccessedAt: string | null;
  accessCount: number;
  humanClickConfirmedAt: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  convertedAt: string | null;
  convertedPlan: string | null;
  expiredAt: string | null;
  institute: {
    id: string;
    name: string;
    slug: string;
    subscriptionPlan: string;
    city?: { name: string } | null;
    managers?: Array<{
      user: { name: string | null; email: string | null; phone: string | null };
    }>;
  };
}

interface DashboardPayload {
  kpis: {
    activeCount: number;
    expiringSoonCount: number;
    convertedCount: number;
    conversionRate: number;
    convertedRevenue: number;
    eligibleBasicCount: number;
  };
  funnel: {
    sent: number;
    delivered: number;
    bounced: number;
    linkAccessed: number;
    humanConfirmed: number;
    activated: number;
    converted: number;
    expired: number;
  };
  outbox: {
    pendingCount: number;
    failedEvents: Array<{ id: string; aggregateId: string; lastError: string | null; attempts: number }>;
  };
  trials: TrialRow[];
  recentAuditLogs: Array<{
    id: string;
    action: string;
    reason: string | null;
    createdAt: string;
    institute: { name: string };
    actor?: { name: string | null; email: string | null } | null;
  }>;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TrialsMonitorClient() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Campaign blast state
  const [batchId, setBatchId] = useState(`batch-${new Date().toISOString().slice(0, 10)}`);
  const [batchLimit, setBatchLimit] = useState(25);

  // Extend / Grant modal state
  const [extendTarget, setExtendTarget] = useState<TrialRow | null>(null);
  const [extendDays, setExtendDays] = useState(3);
  const [extendReason, setExtendReason] = useState("");

  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantInstituteId, setGrantInstituteId] = useState("");
  const [grantInstituteSearch, setGrantInstituteSearch] = useState("");
  const [grantSelectedInst, setGrantSelectedInst] = useState<{
    id: string;
    name: string;
    subscriptionPlan: string;
    hasUsedTrial: boolean;
    city?: { name: string } | null;
  } | null>(null);
  const [grantLookupResults, setGrantLookupResults] = useState<
    Array<{
      id: string;
      name: string;
      subscriptionPlan: string;
      hasUsedTrial: boolean;
      city?: { name: string } | null;
    }>
  >([]);
  const [grantLookupLoading, setGrantLookupLoading] = useState(false);
  const [grantDays, setGrantDays] = useState(7);
  const [grantReason, setGrantReason] = useState("");

  useEffect(() => {
    if (!showGrantModal || grantSelectedInst) return;
    const q = grantInstituteSearch.trim();
    if (q.length < 2) {
      setGrantLookupResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setGrantLookupLoading(true);
      try {
        const res = await fetch(`/api/admin/trials?lookup=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.institutes)) {
          setGrantLookupResults(json.institutes);
        }
      } finally {
        setGrantLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [grantInstituteSearch, showGrantModal, grantSelectedInst]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        source: sourceFilter,
        q: searchQuery,
      });
      const res = await fetch(`/api/admin/trials?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runPostAction = async (payload: Record<string, unknown>, label: string) => {
    setBusyAction(label);
    setBannerMsg(null);
    try {
      const res = await fetch("/api/admin/trials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setBannerMsg({ type: "err", text: json.error || `${label} failed` });
        return false;
      }
      setBannerMsg({
        type: "ok",
        text:
          label === "SEND_CAMPAIGN"
            ? `Campaign "${json.campaignBatchId}": sent ${json.sentCount} emails (${json.failedCount} failed, ${json.targeted} targeted).`
            : `${label} succeeded.`,
      });
      await loadData();
      return true;
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportCsv = () => {
    if (!data?.trials.length) return;
    const headers = [
      "Institute",
      "City",
      "RecipientEmail",
      "Source",
      "Status",
      "Batch",
      "SentAt",
      "DeliveredAt",
      "BouncedAt",
      "LinkAccessedAt",
      "AccessCount",
      "HumanConfirmedAt",
      "StartedAt",
      "ExpiresAt",
      "ConvertedAt",
      "ConvertedPlan",
    ];
    const rows = data.trials.map((t) => [
      `"${(t.institute.name || "").replace(/"/g, '""')}"`,
      `"${t.institute.city?.name || ""}"`,
      t.recipientEmail || "",
      t.source,
      t.status,
      t.campaignBatchId || "",
      t.emailSentAt || "",
      t.emailDeliveredAt || "",
      t.emailBouncedAt || "",
      t.linkAccessedAt || "",
      String(t.accessCount),
      t.humanClickConfirmedAt || "",
      t.startedAt || "",
      t.expiresAt || "",
      t.convertedAt || "",
      t.convertedPlan || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `academyfind-trials-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-amber-500" />
            Trials &amp; Conversions Monitor
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Track 7-day Elite (ULTRA) outreach, email link clicks, active trials, conversions, and outbox sync health.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="rounded-xl">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="rounded-xl">
            <Download className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => setShowGrantModal(true)}
            className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Grant / Override Trial
          </Button>
        </div>
      </div>

      {bannerMsg && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-semibold border ${
            bannerMsg.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {bannerMsg.text}
        </div>
      )}

      {/* KPI Cards */}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-xs font-bold text-amber-900 uppercase tracking-wider">Active Trials</p>
              <p className="text-3xl font-black text-slate-900 mt-1">{data.kpis.activeCount}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
              <p className="text-xs font-bold text-orange-900 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Expiring ≤ 48h
              </p>
              <p className="text-3xl font-black text-slate-900 mt-1">{data.kpis.expiringSoonCount}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Converted</p>
              <p className="text-3xl font-black text-slate-900 mt-1">
                {data.kpis.convertedCount}{" "}
                <span className="text-sm font-bold text-emerald-700">({data.kpis.conversionRate}%)</span>
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                <IndianRupee className="w-3.5 h-3.5" /> Trial Revenue
              </p>
              <p className="text-3xl font-black text-slate-900 mt-1">
                ₹{data.kpis.convertedRevenue.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Eligible BASIC</p>
              <p className="text-3xl font-black text-slate-900 mt-1">{data.kpis.eligibleBasicCount}</p>
            </div>
          </div>

          {/* Funnel Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-3">
              Outreach &amp; Conversion Funnel
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-center">
              {[
                { label: "Emails Sent", val: data.funnel.sent, icon: Mail },
                { label: "Delivered", val: data.funnel.delivered, icon: CheckCircle2 },
                { label: "Bounced", val: data.funnel.bounced, icon: AlertTriangle },
                { label: "Link Accessed", val: data.funnel.linkAccessed, icon: MousePointerClick },
                { label: "Human Click", val: data.funnel.humanConfirmed, icon: MousePointerClick },
                { label: "Activated", val: data.funnel.activated, icon: Sparkles },
                { label: "Converted", val: data.funnel.converted, icon: IndianRupee },
                { label: "Expired", val: data.funnel.expired, icon: Clock },
              ].map((step) => (
                <div key={step.label} className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                  <step.icon className="w-4 h-4 mx-auto text-amber-600 mb-1" />
                  <p className="text-xl font-black text-slate-900">{step.val}</p>
                  <p className="text-[11px] font-semibold text-slate-600">{step.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign Sender + Outbox Sync Health */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-600" />
                Send Email Campaign to Eligible BASIC Managers
              </h2>
              <p className="text-xs text-slate-600">
                Targets active BASIC institutes that have not used a trial and have not been emailed in this batch.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  placeholder="Batch ID"
                  className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium"
                />
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={batchLimit}
                  onChange={(e) => setBatchLimit(Number(e.target.value))}
                  className="w-24 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium"
                />
                <Button
                  size="sm"
                  disabled={busyAction === "SEND_CAMPAIGN"}
                  onClick={() =>
                    runPostAction(
                      { action: "SEND_CAMPAIGN", campaignBatchId: batchId, limit: batchLimit },
                      "SEND_CAMPAIGN"
                    )
                  }
                  className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
                >
                  {busyAction === "SEND_CAMPAIGN" ? "Sending..." : `Send Batch (${batchLimit})`}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-slate-700" />
                  Meilisearch Outbox Sync Health
                </h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction === "RETRY_OUTBOX"}
                  onClick={() => runPostAction({ action: "RETRY_OUTBOX" }, "RETRY_OUTBOX")}
                  className="rounded-xl text-xs"
                >
                  {busyAction === "RETRY_OUTBOX" ? "Retrying..." : "Retry Failed Syncs"}
                </Button>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold">
                <span className="text-slate-700">Pending/In-Flight: {data.outbox.pendingCount}</span>
                <span className={data.outbox.failedEvents.length > 0 ? "text-rose-700 font-bold" : "text-emerald-700"}>
                  Failed (Dead-letter): {data.outbox.failedEvents.length}
                </span>
              </div>
              {data.outbox.failedEvents.length > 0 && (
                <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl p-2.5 max-h-24 overflow-auto">
                  {data.outbox.failedEvents.map((ev) => (
                    <div key={ev.id}>
                      {ev.aggregateId}: {ev.lastError || "Unknown error"} (attempts: {ev.attempts})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search institute or email..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-semibold"
            >
              <option value="ALL">All Funnel Stages</option>
              <option value="SENT_NOT_CLICKED">Sent Only (Not Clicked)</option>
              <option value="CLICKED_NOT_ACTIVATED">Clicked (Not Activated)</option>
              <option value="ACTIVE">Active Trials</option>
              <option value="EXPIRING_SOON">Expiring ≤ 48h</option>
              <option value="CONVERTED">Converted to Paid</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-semibold"
            >
              <option value="ALL">All Sources</option>
              <option value="EMAIL_CAMPAIGN">Email Campaign</option>
              <option value="NEW_CLAIM">New Claim</option>
              <option value="NEW_REQUEST">New Request</option>
              <option value="ADMIN_GRANT">Admin Grant</option>
            </select>
          </div>

          {/* Trials Table */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold">
                <tr>
                  <th className="p-3.5">Institute</th>
                  <th className="p-3.5">Recipient / Manager</th>
                  <th className="p-3.5">Source &amp; Batch</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Email &amp; Click Tracking</th>
                  <th className="p-3.5">Trial Window</th>
                  <th className="p-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.trials.map((t) => (
                  <tr key={t.id} className="hover:bg-amber-50/30">
                    <td className="p-3.5">
                      <Link
                        href={`/manager/${t.instituteId}`}
                        className="font-bold text-slate-900 hover:text-amber-700 hover:underline block"
                      >
                        {t.institute.name}
                      </Link>
                      <span className="text-[11px] text-slate-500">
                        {t.institute.city?.name || "—"} • Plan: {t.institute.subscriptionPlan}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-800">{t.recipientEmail || "—"}</div>
                      <div className="text-[11px] text-slate-500">
                        {t.institute.managers?.[0]?.user?.phone || "No phone"}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 font-bold text-[10px] text-slate-700">
                        {t.source}
                      </span>
                      {t.campaignBatchId && (
                        <div className="text-[10px] text-slate-500 mt-0.5">{t.campaignBatchId}</div>
                      )}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full font-extrabold text-[10px] ${
                          t.status === "ACTIVE"
                            ? "bg-amber-100 text-amber-900"
                            : t.status === "CONVERTED"
                            ? "bg-emerald-100 text-emerald-900"
                            : t.status === "EXPIRED"
                            ? "bg-rose-100 text-rose-900"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {t.status}
                        {t.convertedPlan ? ` (${t.convertedPlan})` : ""}
                      </span>
                    </td>
                    <td className="p-3.5 space-y-0.5 text-[11px] text-slate-600">
                      <div>Sent: {fmtDate(t.emailSentAt)}</div>
                      <div>
                        Deliv: {fmtDate(t.emailDeliveredAt)}
                        {t.emailBouncedAt ? " (BOUNCED)" : ""}
                      </div>
                      <div>
                        Link: {fmtDate(t.linkAccessedAt)} ({t.accessCount}x)
                        {t.humanClickConfirmedAt ? " • Human ✓" : ""}
                      </div>
                    </td>
                    <td className="p-3.5 space-y-0.5 text-[11px] text-slate-600">
                      <div>Start: {fmtDate(t.startedAt)}</div>
                      <div>Exp: {fmtDate(t.expiresAt)}</div>
                      {t.convertedAt && <div className="text-emerald-700 font-bold">Conv: {fmtDate(t.convertedAt)}</div>}
                    </td>
                    <td className="p-3.5">
                      {t.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setExtendTarget(t);
                            setExtendDays(3);
                            setExtendReason("");
                          }}
                          className="rounded-lg text-[11px] h-7 px-2.5"
                        >
                          Extend
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.trials.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No trial records match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Audit Log Feed */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-3">
              Recent Trial Audit Logs
            </h2>
            <div className="space-y-2 max-h-64 overflow-auto">
              {data.recentAuditLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between text-xs border-b border-slate-100 pb-2"
                >
                  <div>
                    <span className="font-bold text-slate-900">{log.institute.name}</span>{" "}
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">
                      {log.action}
                    </span>
                    {log.reason && <span className="text-slate-600 ml-2">— {log.reason}</span>}
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">{fmtDate(log.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Extend Modal */}
      {extendTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-black text-lg text-slate-900">
              Extend Trial: {extendTarget.institute.name}
            </h3>
            <p className="text-xs text-slate-600">
              Maximum total duration is 14 days from original start date.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Additional Days</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={extendDays}
                  onChange={(e) => setExtendDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Audit Reason (Required)</label>
                <input
                  value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  placeholder="e.g., Manager requested extra time to finish setup"
                  className="w-full px-3 py-2 text-sm border rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setExtendTarget(null)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                disabled={busyAction === "EXTEND_TRIAL"}
                onClick={async () => {
                  const ok = await runPostAction(
                    {
                      action: "EXTEND_TRIAL",
                      trialId: extendTarget.id,
                      additionalDays: extendDays,
                      reason: extendReason,
                    },
                    "EXTEND_TRIAL"
                  );
                  if (ok) setExtendTarget(null);
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
              >
                Confirm Extension
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Grant / Override Modal */}
      {showGrantModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-black text-lg text-slate-900">Admin Grant / Override Trial</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Search Institute (Name, City, Email, or ID)
                </label>
                {grantSelectedInst ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/70">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {grantSelectedInst.name}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        {grantSelectedInst.city?.name || "—"} • Plan: {grantSelectedInst.subscriptionPlan}
                        {grantSelectedInst.hasUsedTrial ? " • Used Trial" : " • Trial Eligible"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setGrantSelectedInst(null);
                        setGrantInstituteId("");
                        setGrantInstituteSearch("");
                      }}
                      className="text-xs font-bold text-amber-800 hover:text-amber-950 px-2 py-1 rounded-lg hover:bg-amber-200/60 cursor-pointer shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      value={grantInstituteSearch}
                      onChange={(e) => setGrantInstituteSearch(e.target.value)}
                      placeholder="Type at least 2 characters to search..."
                      className="w-full pl-9 pr-3 py-2 text-sm border rounded-xl"
                    />
                    {(grantLookupLoading || grantLookupResults.length > 0 || grantInstituteSearch.trim().length >= 2) && (
                      <div className="mt-1.5 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                        {grantLookupLoading ? (
                          <div className="p-3 text-xs text-slate-500">Searching institutes...</div>
                        ) : grantLookupResults.length === 0 ? (
                          <div className="p-3 text-xs text-slate-500">No matching institutes found.</div>
                        ) : (
                          grantLookupResults.map((inst) => (
                            <button
                              key={inst.id}
                              type="button"
                              onClick={() => {
                                setGrantSelectedInst(inst);
                                setGrantInstituteId(inst.id);
                                setGrantLookupResults([]);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-amber-50/70 transition-colors cursor-pointer"
                            >
                              <div className="text-xs font-bold text-slate-900">{inst.name}</div>
                              <div className="text-[11px] text-slate-500">
                                {inst.city?.name || "—"} • {inst.subscriptionPlan}
                                {inst.hasUsedTrial ? " • Used Trial" : " • Eligible"}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Days (1–14)</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={grantDays}
                  onChange={(e) => setGrantDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Audit Reason (Required)</label>
                <input
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  placeholder="e.g., VIP onboarding support"
                  className="w-full px-3 py-2 text-sm border rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowGrantModal(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                disabled={busyAction === "GRANT_OVERRIDE" || !grantInstituteId}
                onClick={async () => {
                  const ok = await runPostAction(
                    {
                      action: "GRANT_OVERRIDE",
                      instituteId: grantInstituteId,
                      days: grantDays,
                      reason: grantReason,
                    },
                    "GRANT_OVERRIDE"
                  );
                  if (ok) {
                    setShowGrantModal(false);
                    setGrantInstituteId("");
                    setGrantInstituteSearch("");
                    setGrantSelectedInst(null);
                    setGrantReason("");
                  }
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
              >
                Grant Trial
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
