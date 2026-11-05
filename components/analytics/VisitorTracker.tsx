"use client";

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function VisitorTracker() {
  const pathname = usePathname();
  const trackedPages = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pathname) return;
    
    // 1. Immediately drop automated bots & scrapers (Puppeteer, Selenium, Playwright)
    if (typeof window !== 'undefined') {
      if (navigator.webdriver) return;
      // Headless Chrome signature
      if (/HeadlessChrome/.test(navigator.userAgent)) return;
    }

    // 2. Prevent double tracking in React Strict Mode or fast navigations
    const key = pathname;
    if (trackedPages.current.has(key)) return;
    
    // We only want to track public and app pages, not admin API calls
    if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/af-ass-manage')) return;

    trackedPages.current.add(key);

    const trackView = async () => {
      // Don't track hidden tabs or prefetch background runs
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      try {
        await fetch('/api/track', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            eventType: 'PAGE_VIEW',
            pageUrl: pathname,
          }),
        });
      } catch (error) {
        console.error('Failed to track visitor page view', error);
      }
    };

    // Small delay to ensure the page has loaded and other high-priority requests finish
    const timeout = setTimeout(trackView, 1200);
    return () => clearTimeout(timeout);
  }, [pathname]);

  return null;
}
