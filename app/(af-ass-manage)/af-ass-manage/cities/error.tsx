"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function CitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Cities Admin Route Error:", error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-6 space-y-5 animate-in fade-in duration-300">
      <div className="w-16 h-16 bg-amber-50 border border-amber-200 text-amber-600 rounded-3xl flex items-center justify-center shadow-xs">
        <AlertTriangle className="w-8 h-8" />
      </div>

      <div className="max-w-md space-y-2">
        <h2 className="text-2xl font-black text-stone-900 tracking-tight">
          Unable to Load Cities
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          An unexpected error occurred while fetching operational cities. This might be due to a temporary database timeout or network disruption.
        </p>
        {error?.digest && (
          <p className="text-[11px] font-mono text-stone-400 bg-stone-100 py-1 px-2.5 rounded-lg inline-block">
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-stone-900 rounded-xl font-bold text-sm shadow-sm hover:shadow transition-all active:scale-95 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>

        <Link
          href="/af-ass-manage"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-semibold text-sm transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Admin
        </Link>
      </div>
    </div>
  );
}
