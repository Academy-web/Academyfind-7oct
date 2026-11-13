import { google } from 'googleapis';

function formatEnvVar(value: string | undefined) {
  if (!value) return undefined;
  let formatted = value;
  if (formatted.startsWith('"') && formatted.endsWith('"')) {
    formatted = formatted.slice(1, -1);
  }
  return formatted.replace(/\\n/g, '\n');
}

let cachedGscData: any = null;
let lastGscFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
let lastGscErrorTime = 0;
let lastGscErrorData: any = null;
const ERROR_CACHE_TTL_MS = 60 * 1000; // 1 minute error cache

export async function getSearchConsoleData() {
  const siteUrl = process.env.GSC_SITE_URL;
  if (!siteUrl) {
    return { error: 'GSC_SITE_URL is not configured in .env' };
  }

  const now = Date.now();
  if (cachedGscData && now - lastGscFetchTime < CACHE_TTL_MS) {
    return cachedGscData;
  }
  if (lastGscErrorData && now - lastGscErrorTime < ERROR_CACHE_TTL_MS) {
    return lastGscErrorData;
  }

  const fetchPromise = (async () => {
    try {
      const auth = new google.auth.GoogleAuth(
        process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
          ? {
              credentials: {
                client_email: formatEnvVar(process.env.GOOGLE_CLIENT_EMAIL),
                private_key: formatEnvVar(process.env.GOOGLE_PRIVATE_KEY),
              },
              scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
            }
          : {
              scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
            }
      );

      const webmasters = google.webmasters({ version: 'v3', auth });

      // 1. Get Traffic Stats (Clicks/Impressions)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // Last 30 days

      const response = await webmasters.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          dimensions: ['date'],
        },
      });

      const rows = response.data.rows || [];
      const totalClicks = rows.reduce((acc, row) => acc + (row.clicks || 0), 0);
      const totalImpressions = rows.reduce((acc, row) => acc + (row.impressions || 0), 0);

      // Calculate Average Position
      const avgPosition =
        rows.length > 0
          ? rows.reduce((acc, row) => acc + (row.position || 0), 0) / rows.length
          : 0;

      // 2. Get Sitemap Data to find Submitted Pages
      const sitemaps = await webmasters.sitemaps.list({ siteUrl });
      let totalSubmitted = 0;

      if (sitemaps.data.sitemap) {
        for (const sitemap of sitemaps.data.sitemap) {
          if (sitemap.contents) {
            for (const content of sitemap.contents) {
              totalSubmitted += parseInt(content.submitted as string) || 0;
            }
          }
        }
      }

      const result = {
        success: true,
        overview: {
          totalClicks,
          totalImpressions,
          avgPosition: parseFloat(avgPosition.toFixed(1)),
          totalSubmitted,
        },
        chartData: rows.map((row) => ({
          date: row.keys?.[0] || '',
          clicks: row.clicks || 0,
          impressions: row.impressions || 0,
        })),
      };

      cachedGscData = result;
      lastGscFetchTime = Date.now();
      lastGscErrorData = null;
      return result;
    } catch (err: any) {
      console.warn('GSC query caught error:', err?.message || err);
      const fallback = { error: err?.message || 'GSC fetch failed' };
      lastGscErrorData = fallback;
      lastGscErrorTime = Date.now();
      return fallback;
    }
  })().catch((err: any) => ({ error: err?.message || 'GSC unhandled rejection caught' }));

  const timeoutPromise = new Promise<{ error: string }>((resolve) =>
    setTimeout(
      () => resolve({ error: 'Search Console API timed out (Google service unreachable)' }),
      3000
    )
  );

  try {
    const outcome = await Promise.race([fetchPromise, timeoutPromise]);
    if ('error' in outcome) {
      lastGscErrorData = outcome;
      lastGscErrorTime = Date.now();
    }
    return outcome;
  } catch (error: any) {
    console.warn('GSC API non-fatal error:', error?.message || error);
    lastGscErrorData = { error: error?.message || 'Failed to fetch search console data' };
    lastGscErrorTime = Date.now();
    return lastGscErrorData;
  }
}
