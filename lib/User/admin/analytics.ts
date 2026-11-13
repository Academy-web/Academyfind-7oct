import { BetaAnalyticsDataClient } from '@google-analytics/data';

function formatEnvVar(value: string | undefined) {
  if (!value) return undefined;
  let formatted = value;
  if (formatted.startsWith('"') && formatted.endsWith('"')) {
    formatted = formatted.slice(1, -1);
  }
  return formatted.replace(/\\n/g, '\n');
}

let cachedClient: BetaAnalyticsDataClient | null = null;
function getAnalyticsClient() {
  if (cachedClient) return cachedClient;
  const clientEmail = formatEnvVar(process.env.GOOGLE_CLIENT_EMAIL);
  const privateKey = formatEnvVar(process.env.GOOGLE_PRIVATE_KEY);
  cachedClient = new BetaAnalyticsDataClient(
    clientEmail && privateKey
      ? {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey,
          },
        }
      : undefined
  );
  return cachedClient;
}

let cachedTrafficData: any = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
let lastErrorTime = 0;
let lastErrorData: any = null;
const ERROR_CACHE_TTL_MS = 60 * 1000; // 1 minute error cache

export async function getTrafficData() {
  const propertyId = process.env.GA_PROPERTY_ID;
  if (!propertyId) {
    return { error: 'GA_PROPERTY_ID is not configured in .env' };
  }

  const now = Date.now();
  if (cachedTrafficData && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedTrafficData;
  }
  if (lastErrorData && now - lastErrorTime < ERROR_CACHE_TTL_MS) {
    return lastErrorData;
  }

  const client = getAnalyticsClient();

  const fetchPromise = (async () => {
    // Run reports in parallel to cut latency
    const [overviewRes, trendRes, topPagesRes, channelsRes] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'sessions' },
        ],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
    ]);

    const overviewResponse = overviewRes[0];
    const trendResponse = trendRes[0];
    const topPagesResponse = topPagesRes[0];
    const channelsResponse = channelsRes[0];

    const overview = overviewResponse?.rows?.[0]?.metricValues || [];

    const chartData =
      trendResponse?.rows?.map((row) => {
        const dateStr = row.dimensionValues?.[0]?.value || '';
        const formattedDate =
          dateStr.length === 8
            ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
            : dateStr;

        return {
          date: formattedDate,
          visitors: parseInt(row.metricValues?.[0]?.value || '0', 10),
        };
      }) || [];

    const topPages =
      topPagesResponse?.rows?.map((row) => ({
        path: row.dimensionValues?.[0]?.value || '',
        title: row.dimensionValues?.[1]?.value || '',
        views: parseInt(row.metricValues?.[0]?.value || '0', 10),
      })) || [];

    const channels =
      channelsResponse?.rows?.map((row) => ({
        name: row.dimensionValues?.[0]?.value || 'Unknown',
        value: parseInt(row.metricValues?.[0]?.value || '0', 10),
      })) || [];

    const result = {
      success: true,
      overview: {
        activeUsers: overview[0]?.value || '0',
        pageViews: overview[1]?.value || '0',
        sessions: overview[2]?.value || '0',
      },
      chartData,
      topPages,
      channels,
    };

    cachedTrafficData = result;
    lastFetchTime = Date.now();
    lastErrorData = null;
    return result;
  })();

  const timeoutPromise = new Promise<{ error: string }>((resolve) =>
    setTimeout(
      () => resolve({ error: 'GA4 API request timed out (Google service unreachable)' }),
      3000
    )
  );

  try {
    const outcome = await Promise.race([fetchPromise, timeoutPromise]);
    if ('error' in outcome) {
      lastErrorData = outcome;
      lastErrorTime = Date.now();
    }
    return outcome;
  } catch (error: any) {
    console.warn('GA4 API non-fatal error:', error?.message || error);
    lastErrorData = { error: error?.message || 'Failed to fetch analytics data' };
    lastErrorTime = Date.now();
    return lastErrorData;
  }
}
