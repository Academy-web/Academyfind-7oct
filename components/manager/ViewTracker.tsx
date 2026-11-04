'use client';
import { trackInstituteView, startVisitTracker, updateVisitDuration } from '@/lib/User/manager/track';
import { useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL = 45000; // 45 seconds heartbeat instead of 10s

export default function ViewTracker({ instituteId }: { instituteId: string }) {
  const visitIdRef = useRef<string | null>(null);
  const accumulatedSecondsRef = useRef<number>(0);

  useEffect(() => {
    // 1. Existing View Count increment (Legacy)
    trackInstituteView(instituteId);

    // 2. Detailed Analytics (City, Device)
    const initDetailedTracking = async () => {
      const vId = await startVisitTracker(instituteId);
      if (vId) {
        visitIdRef.current = vId;
      }
    };
    initDetailedTracking();

    // 3. Heartbeat for time spent (Only when tab is active and visible)
    const heartbeatInterval = setInterval(() => {
      if (visitIdRef.current && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        updateVisitDuration(visitIdRef.current, 45);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [instituteId]);

  return null;
}
