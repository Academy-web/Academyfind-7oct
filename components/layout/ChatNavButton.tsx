"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";

const POLL_INTERVAL = 60_000; // 60 seconds when active in foreground
const MIN_FETCH_GAP = 15_000; // Prevents duplicate concurrent fetches (e.g. desktop + mobile nav)

let cachedUnreadCount = 0;
let lastFetchTime = 0;

export function ChatNavButton({ className = "" }: { className?: string }) {
  const [unreadCount, setUnreadCount] = useState(cachedUnreadCount);
  const pathname = usePathname();

  const fetchUnreadCount = useCallback(async (force = false) => {
    // Don't fetch if tab is hidden unless forced
    if (typeof document !== "undefined" && document.visibilityState === "hidden" && !force) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastFetchTime < MIN_FETCH_GAP) {
      setUnreadCount(cachedUnreadCount);
      return;
    }

    try {
      lastFetchTime = now;
      const res = await fetch("/api/v2/conversations/unread-count");
      if (res.ok) {
        const data = await res.json();
        const count = data.count ?? 0;
        cachedUnreadCount = count;
        setUnreadCount(count);
      }
    } catch {
      // Ignore network errors
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();

    // Poll only when window is active / visible
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchUnreadCount();
      }
    }, POLL_INTERVAL);

    // Refresh immediately when user returns to this tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchUnreadCount(true);
      }
    };

    const handleFocus = () => {
      fetchUnreadCount(true);
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchUnreadCount]);

  // When user is viewing /chat, refresh unread count after a moment to clear badge
  useEffect(() => {
    if (pathname.startsWith("/chat")) {
      const timer = setTimeout(() => fetchUnreadCount(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [pathname, fetchUnreadCount]);

  return (
    <Link
      href="/chat"
      title={unreadCount > 0 ? `Messages (${unreadCount} new)` : "Messages"}
      aria-label={unreadCount > 0 ? `${unreadCount} unread messages` : "Messages"}
      className={`relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900 ${className}`}
    >
      <MessageCircle className="size-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white leading-none shadow-xs animate-in zoom-in-75 duration-200">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
