"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";

export default function UserActivityTracker() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return <UserActivityTrackerInner />;
}

function UserActivityTrackerInner() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session?.user?.id) {
      // Ping the API to update lastLoginAt (throttled server-side)
      fetch("/api/user/active", { method: "POST" }).catch(() => {});
    }
  }, [session?.user?.id]);

  return null;
}
