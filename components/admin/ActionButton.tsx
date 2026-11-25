"use client";

import { useState } from "react";
import { approvePayment, rejectPayment } from "@/lib/User/admin/adminPaymentApprove";
import toast from "react-hot-toast";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export default function ActionButtons({ paymentId }: { paymentId: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState<{
        isOpen: boolean;
        title: string;
        onConfirm: () => void;
        destructive?: boolean;
    }>({
        isOpen: false,
        title: "",
        onConfirm: () => {},
    });

    const executeApprove = async () => {
        setIsLoading(true);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        const res = await approvePayment(paymentId);
        if (res.success) toast.success(("message" in res && res.message) || "Payment approved sucessfully");
        else toast.error(("error" in res && res.error) || "payment can't be approved");
        setIsLoading(false);
    };

    const executeReject = async () => {
        setIsLoading(true);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        const res = await rejectPayment(paymentId);
        if (res.success) toast.success(res.message || "payment rejected");
        else toast.error(res.error || "payment can't be rejected");
        setIsLoading(false);
    };

    return (
        <>
            <div className="flex gap-3">
                <button 
                    onClick={() => setConfirmConfig({
                        isOpen: true,
                        title: "Reject Transaction?",
                        destructive: true,
                        onConfirm: executeReject
                    })}
                    disabled={isLoading}
                    className="px-4 py-2 bg-white text-red-600 font-bold rounded-xl border border-red-200 hover:bg-red-50 transition flex items-center disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4 mr-1.5" /> Reject</>}
                </button>

                <button 
                    onClick={() => setConfirmConfig({
                        isOpen: true,
                        title: "Approve & Activate Plan?",
                        destructive: false,
                        onConfirm: executeApprove
                    })}
                    disabled={isLoading}
                    className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-md transition flex items-center disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve & Activate</>}
                </button>
            </div>
            
            <ConfirmModal 
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.onConfirm}
                title={confirmConfig.title}
                destructive={confirmConfig.destructive}
            />
        </>
    );
}