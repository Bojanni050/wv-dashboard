require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const app = express();
const PORT = process.env.PORT || 3001;

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '368911252';

const analyticsDataClient = new BetaAnalyticsDataClient();

// --- Basic HTTP Auth middleware ---
function basicAuth(req, res, next) {
  const user = process.env.DASH_USER;
  const pass = process.env.DASH_PASS;

  if (!user || !pass) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="White Vision Dashboard"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const [providedUser, providedPass] = decoded.split(':');

  const hash = (value) => crypto.createHash('sha256').update(value || '').digest();

  const userOk = crypto.timingSafeEqual(hash(providedUser), hash(user));
  const passOk = crypto.timingSafeEqual(hash(providedPass), hash(pass));

  if (!userOk || !passOk) {
    res.setHeader('WWW-Authenticate', 'Basic realm="White Vision Dashboard"');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  next();
}

// --- Helpers ---

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const prevEnd = new Date(start);
  prevEnd.setDate(start.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - days);
  return {
    current: { start: formatDate(start), end: formatDate(end) },
    previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
  };
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Buckets a GA4 sessionDefaultChannelGroup value into the group the
// dashboard cares about. "Paid Social" counts as Paid Ads, not Social,
// so the buckets don't double-count.
function channelBucket(channel) {
  if (channel.startsWith('Paid')) return 'paidAds';
  if (channel === 'Organic Social') return 'social';
  if (channel === 'Organic Search') return 'search';
  return 'overig';
}

function groupByChannel(rows, valueKey) {
  const totals = { paidAds: 0, social: 0, search: 0, overig: 0 };
  rows.forEach((r) => {
    totals[channelBucket(r.channel)] += r[valueKey];
  });
  return totals;
}

function conversionRate(conversions, base) {
  if (base === 0) return 0;
  return Math.round((conversions / base) * 1000) / 10;
}

// --- GA4 API calls ---

async function fetchMetricsForRange(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
    ],
  });

  const row = response.rows?.[0]?.metricValues || [];
  return {
    sessions: parseInt(row[0]?.value || '0', 10),
    users: parseInt(row[1]?.value || '0', 10),
    newUsers: parseInt(row[2]?.value || '0', 10),
    pageviews: parseInt(row[3]?.value || '0', 10),
  };
}

async function fetchChannels(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });

  return (response.rows || []).map((row) => ({
    channel: row.dimensionValues[0].value,
    sessions: parseInt(row.metricValues[0].value, 10),
  }));
}

async function fetchOfferteByPage(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'offerte_form_succes' },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  return (response.rows || []).map((row) => ({
    page: row.dimensionValues[0].value,
    count: parseInt(row.metricValues[0].value, 10),
  }));
}

async function fetchOfferteByChannel(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'offerte_form_succes' },
      },
    },
  });

  return (response.rows || []).map((row) => ({
    channel: row.dimensionValues[0].value,
    count: parseInt(row.metricValues[0].value, 10),
  }));
}

async function fetchDailySessions(dateRange, days) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ dimension: { dimensionName: 'date' }, orderType: 'NUMERIC' }],
  });

  const rows = (response.rows || []).map((row) => ({
    date: row.dimensionValues[0].value,
    sessions: parseInt(row.metricValues[0].value, 10),
  }));

  // Fill in any missing days with zero
  const filled = [];
  const startDate = new Date(dateRange.start);
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = formatDate(d);
    const found = rows.find((r) => r.date === dateStr);
    filled.push({
      date: dateStr,
      sessions: found ? found.sessions : 0,
    });
  }

  return filled;
}

// --- Main endpoint ---

app.get('/api/analytics', basicAuth, async (req, res) => {
  const rangeDays = Math.max(1, Math.min(365, parseInt(req.query.range, 10) || 7));

  try {
    const ranges = getDateRange(rangeDays);

    const [
      currentMetrics,
      previousMetrics,
      channels,
      previousChannels,
      offerteByPage,
      offerteByChannel,
      previousOfferteByChannel,
      dailySessions,
      dailySessionsPrev,
    ] = await Promise.all([
      fetchMetricsForRange(ranges.current),
      fetchMetricsForRange(ranges.previous),
      fetchChannels(ranges.current),
      fetchChannels(ranges.previous),
      fetchOfferteByPage(ranges.current),
      fetchOfferteByChannel(ranges.current),
      fetchOfferteByChannel(ranges.previous),
      fetchDailySessions(ranges.current, rangeDays),
      fetchDailySessions(ranges.previous, rangeDays),
    ]);

    const offerteCount = offerteByPage.reduce((sum, r) => sum + r.count, 0);

    // Fetch previous period offerte count
    const prevOfferte = await fetchOfferteByPage(ranges.previous);
    const prevOfferteCount = prevOfferte.reduce((sum, r) => sum + r.count, 0);

    const channelGroups = groupByChannel(channels, 'sessions');
    const prevChannelGroups = groupByChannel(previousChannels, 'sessions');
    const offerteChannelGroups = groupByChannel(offerteByChannel, 'count');
    const prevOfferteChannelGroups = groupByChannel(previousOfferteByChannel, 'count');

    const conversionTotal = conversionRate(offerteCount, currentMetrics.users);
    const prevConversionTotal = conversionRate(prevOfferteCount, previousMetrics.users);

    const conversionPaid = conversionRate(offerteChannelGroups.paidAds, channelGroups.paidAds);
    const prevConversionPaid = conversionRate(prevOfferteChannelGroups.paidAds, prevChannelGroups.paidAds);

    const conversionSocial = conversionRate(offerteChannelGroups.social, channelGroups.social);
    const prevConversionSocial = conversionRate(prevOfferteChannelGroups.social, prevChannelGroups.social);

    res.json({
      range: rangeDays,
      kpis: {
        sessions: {
          current: currentMetrics.sessions,
          previous: previousMetrics.sessions,
          change: pctChange(currentMetrics.sessions, previousMetrics.sessions),
        },
        users: {
          current: currentMetrics.users,
          previous: previousMetrics.users,
          change: pctChange(currentMetrics.users, previousMetrics.users),
        },
        pageviews: {
          current: currentMetrics.pageviews,
          previous: previousMetrics.pageviews,
          change: pctChange(currentMetrics.pageviews, previousMetrics.pageviews),
        },
        offertes: {
          current: offerteCount,
          previous: prevOfferteCount,
          change: pctChange(offerteCount, prevOfferteCount),
        },
        paidAds: {
          current: channelGroups.paidAds,
          previous: prevChannelGroups.paidAds,
          change: pctChange(channelGroups.paidAds, prevChannelGroups.paidAds),
        },
        social: {
          current: channelGroups.social,
          previous: prevChannelGroups.social,
          change: pctChange(channelGroups.social, prevChannelGroups.social),
        },
        search: {
          current: channelGroups.search,
          previous: prevChannelGroups.search,
          change: pctChange(channelGroups.search, prevChannelGroups.search),
        },
        overig: {
          current: channelGroups.overig,
          previous: prevChannelGroups.overig,
          change: pctChange(channelGroups.overig, prevChannelGroups.overig),
        },
        conversionTotal: {
          current: conversionTotal,
          previous: prevConversionTotal,
          change: pctChange(conversionTotal, prevConversionTotal),
        },
        conversionPaid: {
          current: conversionPaid,
          previous: prevConversionPaid,
          change: pctChange(conversionPaid, prevConversionPaid),
        },
        conversionSocial: {
          current: conversionSocial,
          previous: prevConversionSocial,
          change: pctChange(conversionSocial, prevConversionSocial),
        },
      },
      channels,
      offerteByPage,
      dailySessions,
      dailySessionsPrev,
    });
  } catch (err) {
    console.error('Analytics fetch error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch analytics data',
      detail: err.message,
    });
  }
});

// --- Serve static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Start ---
app.listen(PORT, () => {
  console.log(`White Vision Dashboard running on port ${PORT}`);
});
