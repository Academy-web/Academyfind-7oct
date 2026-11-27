"use client";

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function VisitorTracker() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return <VisitorTrackerInner />;
}

function VisitorTrackerInner() {
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
      } catch (err) {
        // Fail silently so user experience is never blocked by metrics
      }
    };

    trackView();
  }, [pathname]);

  return null;
}
