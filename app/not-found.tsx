import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 mb-6 shadow-sm">
        <Compass className="w-8 h-8 animate-pulse" />
      </div>
      <h1 className="text-6xl font-black text-amber-500 tracking-tight mb-2">404</h1>
      <h2 className="text-2xl font-bold text-stone-900 mb-3">Page Not Found</h2>
      <p className="text-stone-600 mb-8 max-w-md leading-relaxed text-sm">
        The page you are looking for doesn't exist or may have been moved. Let's get you back on track to discovering institutes.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg shadow-amber-500/20"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </Link>
    </div>
  );
}
