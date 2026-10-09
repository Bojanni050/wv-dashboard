require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const ai = require('./ai');
const mailer = require('./mailer');
const { createWeeklyReport, lastWeekRanges } = require('./weekly-report');
const { createMonthlyReport } = require('./monthly-report');
const googleAds = require('./lib/google-ads');
const { createExplainer, isConfigured: isAiConfigured, AUTO_RANGES: AI_AUTO_RANGES } = require('./explain');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '368911252';

const VALID_RANGES = ['today', 'yesterday', '7', '90', 'month', 'custom'];
const VALID_COMPARE = ['previous', 'year'];
const MAX_CUSTOM_RANGE_DAYS = 366;

const analyticsDataClient = new BetaAnalyticsDataClient();

// --- Basic HTTP Auth middleware ---
// Two credential pairs: DASH_USER/DASH_PASS (viewer) and
// ADMIN_USER/ADMIN_PASS (admin). Sets req.role so routes can gate
// admin-only actions like uploading reports.
function basicAuth(req, res, next) {
  const viewerUser = process.env.DASH_USER;
  const viewerPass = process.env.DASH_PASS;
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  if (!viewerUser || !viewerPass) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const [providedUser, providedPass] = decoded.split(':');

  const hash = (value) => crypto.createHash('sha256').update(value || '').digest();
  const matches = (user, pass) =>
    crypto.timingSafeEqual(hash(providedUser), hash(user)) &&
    crypto.timingSafeEqual(hash(providedPass), hash(pass));

  const isAdmin = Boolean(adminUser && adminPass && matches(adminUser, adminPass));
  const isViewer = !isAdmin && matches(viewerUser, viewerPass);

  if (!isAdmin && !isViewer) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.role = isAdmin ? 'admin' : 'viewer';
  next();
}

function requireAdmin(req, res, next) {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
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

function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// Resolves the requested range into a concrete { rangeParam, customStart,
// customEnd } triple, falling back to '7' whenever 'custom' is requested
// without a valid, sane start/end pair.
function resolveRangeParam(query) {
  if (query.range === 'custom') {
    const { start, end } = query;
    if (
      isValidDateStr(start) &&
      isValidDateStr(end) &&
      start <= end &&
      end <= formatDate(new Date()) &&
      daysInRange({ start, end }) <= MAX_CUSTOM_RANGE_DAYS
    ) {
      return { rangeParam: 'custom', customStart: start, customEnd: end };
    }
    return { rangeParam: '7' };
  }

  if (VALID_RANGES.includes(query.range)) return { rangeParam: query.range };
  return { rangeParam: '7' };
}

// rangeParam is 'today' | 'yesterday' | '7' | '90' | 'month' | 'custom'
function resolveCurrentRange(rangeParam, customStart, customEnd) {
  const end = new Date();

  if (rangeParam === 'custom') {
    return { start: customStart, end: customEnd };
  }

  if (rangeParam === 'today') {
    return { start: formatDate(end), end: formatDate(end) };
  }

  if (rangeParam === 'yesterday') {
    const yesterday = new Date(end);
    yesterday.setDate(end.getDate() - 1);
    return { start: formatDate(yesterday), end: formatDate(yesterday) };
  }

  if (rangeParam === 'month') {
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { start: formatDate(start), end: formatDate(end) };
  }

  const start = new Date();
  start.setDate(end.getDate() - parseInt(rangeParam, 10));
  return { start: formatDate(start), end: formatDate(end) };
}

// compareParam is 'previous' (period immediately before, same length) or
// 'year' (same calendar dates, one year earlier)
function resolveComparisonRange(current, compareParam) {
  const currentStart = new Date(current.start);
  const currentEnd = new Date(current.end);

  if (compareParam === 'year') {
    const prevStart = new Date(currentStart);
    prevStart.setFullYear(prevStart.getFullYear() - 1);
    const prevEnd = new Date(currentEnd);
    prevEnd.setFullYear(prevEnd.getFullYear() - 1);
    return { start: formatDate(prevStart), end: formatDate(prevEnd) };
  }

  const lengthDays = Math.round((currentEnd - currentStart) / 86400000) + 1;
  const prevEnd = new Date(currentStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - (lengthDays - 1));
  return { start: formatDate(prevStart), end: formatDate(prevEnd) };
}

function getRanges(rangeParam, compareParam, customStart, customEnd) {
  const current = resolveCurrentRange(rangeParam, customStart, customEnd);
  const previous = resolveComparisonRange(current, compareParam);
  return { current, previous };
}

function daysInRange(range) {
  const start = new Date(range.start);
  const end = new Date(range.end);
  return Math.round((end - start) / 86400000) + 1;
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

// Engagement metrics come from GA4 (average session duration, pages per
// session, engagement rate and bounce rate).
async function fetchMetricsForRange(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'screenPageViewsPerSession' },
      { name: 'engagementRate' },
      { name: 'bounceRate' },
    ],
  });

  const row = response.rows?.[0]?.metricValues || [];
  const num = (i) => parseFloat(row[i]?.value || '0') || 0;

  return {
    sessions: parseInt(row[0]?.value || '0', 10),
    users: parseInt(row[1]?.value || '0', 10),
    newUsers: parseInt(row[2]?.value || '0', 10),
    pageviews: parseInt(row[3]?.value || '0', 10),
    avgSessionDuration: Math.round(num(4)),
    pagesPerSession: Math.round(num(5) * 10) / 10,
    engagementRate: Math.round(num(6) * 1000) / 10,
    bounceRate: Math.round(num(7) * 1000) / 10,
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

// --- Offerte (quote request) counting ---
//
// A "conversion" is a session in which the quote form was submitted. We count
// unique sessions, not events: the tracking fires the success events 2-4 times
// per submission (form_submit and offerte_form_succes double-fire), and
// generate_lead also fires on non-form interactions, so event counts overstate
// conversions.
//
// The event that marks a submission also changed over time. The dedicated
// gforms_submission event only exists from OFFERTE_EVENT_SWITCH_DATE; before
// that, form_submit is the only event that was measured the whole year. Ranges
// that span the switch are queried in two parts and added together, so periods
// before mid-September no longer show 0 offertes.
const OFFERTE_EVENT = 'gforms_submission';
const LEGACY_OFFERTE_EVENT = 'form_submit';
const OFFERTE_EVENT_SWITCH_DATE = '2026-09-15';
const LEGACY_LAST_DATE = '2026-09-14';

function offerteEventParts(dateRange) {
  const parts = [];
  if (dateRange.start <= LEGACY_LAST_DATE) {
    parts.push({
      event: LEGACY_OFFERTE_EVENT,
      start: dateRange.start,
      end: dateRange.end < LEGACY_LAST_DATE ? dateRange.end : LEGACY_LAST_DATE,
    });
  }
  if (dateRange.end >= OFFERTE_EVENT_SWITCH_DATE) {
    parts.push({
      event: OFFERTE_EVENT,
      start: dateRange.start > OFFERTE_EVENT_SWITCH_DATE ? dateRange.start : OFFERTE_EVENT_SWITCH_DATE,
      end: dateRange.end,
    });
  }
  return parts;
}

// Sessions with a quote submission, grouped by one GA4 dimension. Returns
// [{ key, count }] sorted by count, descending.
async function fetchOfferteSessions(dateRange, dimension, extraFilters = []) {
  const parts = offerteEventParts(dateRange);
  const results = await Promise.all(
    parts.map(async (part) => {
      const [response] = await analyticsDataClient.runReport({
        property: `properties/${PROPERTY_ID}`,
        dateRanges: [{ startDate: part.start, endDate: part.end }],
        dimensions: [{ name: dimension }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: part.event },
                },
              },
              ...extraFilters,
            ],
          },
        },
      });
      return response.rows || [];
    })
  );

  const totals = new Map();
  results.flat().forEach((row) => {
    const key = row.dimensionValues[0].value;
    totals.set(key, (totals.get(key) || 0) + parseInt(row.metricValues[0].value, 10));
  });

  return [...totals.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

async function fetchOfferteByPage(dateRange) {
  const rows = await fetchOfferteSessions(dateRange, 'pagePath');
  return rows.map((r) => ({ page: r.key, count: r.count }));
}

async function fetchOfferteByChannel(dateRange) {
  const rows = await fetchOfferteSessions(dateRange, 'sessionDefaultChannelGroup');
  return rows.map((r) => ({ channel: r.key, count: r.count }));
}

async function fetchOfferteByCampaign(dateRange) {
  const rows = await fetchOfferteSessions(dateRange, 'sessionCampaignName', [
    {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        stringFilter: { matchType: 'BEGINS_WITH', value: 'Paid' },
      },
    },
  ]);
  return rows.map((r) => ({ campaign: r.key, count: r.count }));
}

// --- Conversion per social platform ---

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin'];

// Maps a GA4 sessionSource (ig, l.facebook.com, linkedin.com, ...) to one
// of the tracked platforms, or null for any other source.
function socialPlatform(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('facebook') || s === 'fb') return 'facebook';
  if (s.includes('instagram') || s === 'ig') return 'instagram';
  if (s.includes('linkedin') || s === 'lnkd.in') return 'linkedin';
  return null;
}

const ORGANIC_SOCIAL_FILTER = {
  filter: {
    fieldName: 'sessionDefaultChannelGroup',
    stringFilter: { matchType: 'EXACT', value: 'Organic Social' },
  },
};

// Sessions and quote submissions from Organic Social, split per platform.
async function fetchSocialByPlatform(dateRange) {
  const [[sessionsResponse], offerteRows] = await Promise.all([
    analyticsDataClient.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: ORGANIC_SOCIAL_FILTER,
    }),
    fetchOfferteSessions(dateRange, 'sessionSource', [ORGANIC_SOCIAL_FILTER]),
  ]);

  const result = {};
  SOCIAL_PLATFORMS.forEach((p) => {
    result[p] = { sessions: 0, offertes: 0 };
  });

  (sessionsResponse.rows || []).forEach((row) => {
    const platform = socialPlatform(row.dimensionValues[0].value);
    if (platform) result[platform].sessions += parseInt(row.metricValues[0].value, 10);
  });
  offerteRows.forEach((r) => {
    const platform = socialPlatform(r.key);
    if (platform) result[platform].offertes += r.count;
  });

  return result;
}

async function fetchTopPages(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });

  return (response.rows || []).map((row) => ({
    page: row.dimensionValues[0].value,
    pageviews: parseInt(row.metricValues[0].value, 10),
  }));
}

// GA4's 'date' dimension comes back as YYYYMMDD (no separators)
function ga4DateToIso(ga4Date) {
  return `${ga4Date.slice(0, 4)}-${ga4Date.slice(4, 6)}-${ga4Date.slice(6, 8)}`;
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
    date: ga4DateToIso(row.dimensionValues[0].value),
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

async function buildAnalytics(ranges, rangeParam, compareParam) {
  const [
    currentMetrics,
    previousMetrics,
    channels,
    previousChannels,
    offerteByPage,
    offerteByChannel,
    previousOfferteByChannel,
    offerteByCampaign,
    dailySessions,
    dailySessionsPrev,
    topPages,
    socialByPlatform,
    previousSocialByPlatform,
  ] = await Promise.all([
    fetchMetricsForRange(ranges.current),
    fetchMetricsForRange(ranges.previous),
    fetchChannels(ranges.current),
    fetchChannels(ranges.previous),
    fetchOfferteByPage(ranges.current),
    fetchOfferteByChannel(ranges.current),
    fetchOfferteByChannel(ranges.previous),
    fetchOfferteByCampaign(ranges.current),
    fetchDailySessions(ranges.current, daysInRange(ranges.current)),
    fetchDailySessions(ranges.previous, daysInRange(ranges.previous)),
    fetchTopPages(ranges.current),
    fetchSocialByPlatform(ranges.current),
    fetchSocialByPlatform(ranges.previous),
  ]);

  // Channel is session-scoped, so these rows are unique sessions and their
  // sum is the number of converting sessions (page rows could count one
  // session twice).
  const offerteCount = offerteByChannel.reduce((sum, r) => sum + r.count, 0);
  const prevOfferteCount = previousOfferteByChannel.reduce((sum, r) => sum + r.count, 0);

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

  const socialPlatforms = {};
  SOCIAL_PLATFORMS.forEach((p) => {
    const cur = socialByPlatform[p];
    const prev = previousSocialByPlatform[p];
    const rate = conversionRate(cur.offertes, cur.sessions);
    const prevRate = conversionRate(prev.offertes, prev.sessions);
    socialPlatforms[p] = {
      sessions: cur.sessions,
      offertes: cur.offertes,
      conversion: { current: rate, previous: prevRate, change: pctChange(rate, prevRate) },
    };
  });

  return {
    range: rangeParam,
    compare: compareParam,
    periodStart: ranges.current.start,
    periodEnd: ranges.current.end,
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
      avgSessionDuration: {
        current: currentMetrics.avgSessionDuration,
        previous: previousMetrics.avgSessionDuration,
        change: pctChange(currentMetrics.avgSessionDuration, previousMetrics.avgSessionDuration),
      },
      pagesPerSession: {
        current: currentMetrics.pagesPerSession,
        previous: previousMetrics.pagesPerSession,
        change: pctChange(currentMetrics.pagesPerSession, previousMetrics.pagesPerSession),
      },
      engagementRate: {
        current: currentMetrics.engagementRate,
        previous: previousMetrics.engagementRate,
        change: pctChange(currentMetrics.engagementRate, previousMetrics.engagementRate),
      },
      bounceRate: {
        current: currentMetrics.bounceRate,
        previous: previousMetrics.bounceRate,
        change: pctChange(currentMetrics.bounceRate, previousMetrics.bounceRate),
      },
    },
    socialPlatforms,
    channels,
    offerteByPage,
    offerteByChannel,
    offerteByCampaign,
    dailySessions,
    dailySessionsPrev,
    topPages,
  };
}

app.get('/api/analytics', basicAuth, async (req, res) => {
  const { rangeParam, customStart, customEnd } = resolveRangeParam(req.query);
  const compareParam = VALID_COMPARE.includes(req.query.compare) ? req.query.compare : 'previous';

  try {
    const ranges = getRanges(rangeParam, compareParam, customStart, customEnd);
    res.json(await buildAnalytics(ranges, rangeParam, compareParam));
  } catch (err) {
    console.error('Analytics fetch error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch analytics data',
      detail: err.message,
    });
  }
});

// --- Reports (admin uploads, everyone with dashboard access can view/download) ---

const REPORTS_DIR = path.join(__dirname, 'reports');
const REPORTS_INDEX_FILE = path.join(REPORTS_DIR, '_index.json');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function readReportsIndex() {
  ensureReportsDir();
  if (!fs.existsSync(REPORTS_INDEX_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(REPORTS_INDEX_FILE, 'utf8'));
  } catch (err) {
    console.error('Reports index read error:', err.message);
    return [];
  }
}

function writeReportsIndex(list) {
  ensureReportsDir();
  fs.writeFileSync(REPORTS_INDEX_FILE, JSON.stringify(list, null, 2));
}

function saveReport(buffer, originalName) {
  const id = crypto.randomUUID();
  ensureReportsDir();
  fs.writeFileSync(path.join(REPORTS_DIR, id + '.pdf'), buffer);

  const entry = {
    id,
    originalName,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  };

  const list = readReportsIndex();
  list.unshift(entry);
  writeReportsIndex(list);
  return entry;
}

const reportsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Alleen PDF-bestanden zijn toegestaan'));
    }
    cb(null, true);
  },
});

app.get('/api/me', basicAuth, (req, res) => {
  res.json({ role: req.role });
});

app.get('/api/reports', basicAuth, (req, res) => {
  res.json(readReportsIndex());
});

app.post('/api/reports', basicAuth, requireAdmin, (req, res) => {
  reportsUpload.single('report')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });

    res.status(201).json(saveReport(req.file.buffer, req.file.originalname));
  });
});

app.get('/api/reports/:id', basicAuth, (req, res) => {
  const entry = readReportsIndex().find((r) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Rapport niet gevonden' });

  const filePath = path.join(REPORTS_DIR, entry.id + '.pdf');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bestand niet gevonden' });

  res.download(filePath, entry.originalName);
});

app.delete('/api/reports/:id', basicAuth, requireAdmin, (req, res) => {
  const list = readReportsIndex();
  const entry = list.find((r) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Rapport niet gevonden' });

  const filePath = path.join(REPORTS_DIR, entry.id + '.pdf');
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Report delete error:', err.message);
    return res.status(500).json({ error: 'Bestand verwijderen mislukt' });
  }
  writeReportsIndex(list.filter((r) => r.id !== entry.id));
  res.json({ ok: true });
});

// --- Google Ads (figures pulled from Windsor.ai; legacy manual file as fallback) ---

const DATA_DIR = path.join(__dirname, 'data');
const GOOGLE_ADS_FILE = path.join(DATA_DIR, 'google-ads.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isNonNegativeNumber(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0;
}

function emptyGoogleAds() {
  return { clicks: 0, impressions: 0, costOfClicks: 0, costPerClick: 0, campaigns: [], updatedAt: null };
}

// The old manually-entered snapshot, kept only so the tab still has something
// to show when Windsor is not configured. It is no longer editable from the UI.
function readGoogleAdsFallback() {
  ensureDataDir();
  if (!fs.existsSync(GOOGLE_ADS_FILE)) return emptyGoogleAds();
  try {
    return Object.assign(emptyGoogleAds(), JSON.parse(fs.readFileSync(GOOGLE_ADS_FILE, 'utf8')));
  } catch (err) {
    console.error('Google Ads data read error:', err.message);
    return emptyGoogleAds();
  }
}

// range is { start, end } (both 'YYYY-MM-DD', inclusive). When omitted it
// defaults to the last complete Monday–Sunday week, matching the weekly report.
async function readGoogleAds(range) {
  if (!googleAds.isConfigured()) return readGoogleAdsFallback();
  const effective = range && range.start && range.end ? range : lastWeekRanges(new Date()).current;
  try {
    const result = await googleAds.fetchRange(effective);
    return result || readGoogleAdsFallback();
  } catch (err) {
    console.error('Google Ads (Windsor) fetch failed:', err.message);
    return readGoogleAdsFallback();
  }
}

app.get('/api/google-ads', basicAuth, async (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const range =
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { start: from, end: to } : undefined;
  try {
    res.json(await readGoogleAds(range));
  } catch (err) {
    console.error('Google Ads endpoint error:', err.message);
    res.status(500).json({ error: 'Google Ads-gegevens ophalen mislukt' });
  }
});

// --- AI settings + weekly report (admin only) ---

app.get('/api/ai/settings', basicAuth, requireAdmin, (req, res) => {
  res.json(ai.publicSettings(ai.readSettings()));
});

app.put('/api/ai/settings', basicAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const settings = ai.readSettings();

  if (!ai.PROVIDERS[body.activeProvider]) {
    return res.status(400).json({ error: 'Onbekende provider' });
  }

  try {
    Object.keys(ai.PROVIDERS).forEach((key) => {
      const incoming = (body.providers || {})[key];
      if (!incoming) return;
      const current = settings.providers[key];
      current.baseUrl = ai.normalizeBaseUrl(incoming.baseUrl || ai.PROVIDERS[key].defaultBaseUrl);
      current.model = String(incoming.model || '').trim();
      // Blank key = keep the stored one
      if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) current.apiKey = incoming.apiKey.trim();
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const incomingSmtp = body.smtp;
  if (incomingSmtp) {
    const port = parseInt(incomingSmtp.port, 10);
    if (incomingSmtp.port !== undefined && incomingSmtp.port !== '' && (!isNonNegativeNumber(port) || port === 0 || port > 65535)) {
      return res.status(400).json({ error: 'SMTP-poort moet een geldig poortnummer zijn.' });
    }
    settings.smtp = Object.assign({}, settings.smtp, {
      host: String(incomingSmtp.host || '').trim(),
      port: port || settings.smtp.port || 587,
      secure: Boolean(incomingSmtp.secure),
      user: String(incomingSmtp.user || '').trim(),
      from: String(incomingSmtp.from || '').trim(),
      to: String(incomingSmtp.to || '').trim(),
    });
    // Blank password = keep the stored one
    if (typeof incomingSmtp.pass === 'string' && incomingSmtp.pass.trim()) settings.smtp.pass = incomingSmtp.pass.trim();
  }

  settings.activeProvider = body.activeProvider;
  settings.weeklyReportEnabled = Boolean(body.weeklyReportEnabled);
  settings.monthlyReportEnabled = Boolean(body.monthlyReportEnabled);
  settings.weeklyActionsEnabled = Boolean(body.weeklyActionsEnabled);
  settings.monthlyActionsEnabled = Boolean(body.monthlyActionsEnabled);
  ai.writeSettings(settings);
  res.json(ai.publicSettings(settings));
});

app.post('/api/ai/smtp-test', basicAuth, requireAdmin, async (req, res) => {
  try {
    const to = typeof (req.body || {}).to === 'string' && req.body.to.trim() ? req.body.to.trim() : undefined;
    await mailer.sendTestMail(to);
    res.json({ ok: true, to: to || mailer.reportRecipient() });
  } catch (err) {
    console.error('SMTP test mail failed:', err.message);
    res.status(400).json({ error: 'Testmail versturen mislukt: ' + err.message });
  }
});

app.post('/api/ai/models', basicAuth, requireAdmin, async (req, res) => {
  const { provider, baseUrl, apiKey } = req.body || {};
  if (!ai.PROVIDERS[provider]) return res.status(400).json({ error: 'Onbekende provider' });

  const stored = ai.readSettings().providers[provider];
  try {
    const models = await ai.listModels(
      provider,
      baseUrl || stored.baseUrl,
      (typeof apiKey === 'string' && apiKey.trim()) || stored.apiKey
    );
    res.json({ models });
  } catch (err) {
    res.status(400).json({ error: 'Modellen ophalen mislukt: ' + err.message });
  }
});

const weeklyReport = createWeeklyReport({
  buildAnalytics,
  readGoogleAds,
  saveReport,
});

const monthlyReport = createMonthlyReport({
  buildAnalytics,
  readGoogleAds,
  saveReport,
});

app.post('/api/ai/weekly-report', basicAuth, requireAdmin, async (req, res) => {
  try {
    const result = await weeklyReport.generate();
    res.status(201).json(result);
  } catch (err) {
    console.error('Manual weekly report failed:', err.message);
    res.status(500).json({ error: 'Weekrapport maken mislukt: ' + err.message });
  }
});

app.post('/api/ai/monthly-report', basicAuth, requireAdmin, async (req, res) => {
  try {
    const result = await monthlyReport.generate();
    res.status(201).json(result);
  } catch (err) {
    console.error('Manual monthly report failed:', err.message);
    res.status(500).json({ error: 'Maandrapport maken mislukt: ' + err.message });
  }
});

app.post('/api/ai/weekly-report-mail', basicAuth, requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await weeklyReport.sendPdf());
  } catch (err) {
    console.error('Manual weekly report mail failed:', err.message);
    res.status(500).json({ error: 'Weekrapport mailen mislukt: ' + err.message });
  }
});

app.post('/api/ai/monthly-report-mail', basicAuth, requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await monthlyReport.sendPdf());
  } catch (err) {
    console.error('Manual monthly report mail failed:', err.message);
    res.status(500).json({ error: 'Maandrapport mailen mislukt: ' + err.message });
  }
});

app.post('/api/ai/weekly-actions', basicAuth, requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await weeklyReport.sendActions());
  } catch (err) {
    console.error('Manual weekly action items mail failed:', err.message);
    res.status(500).json({ error: 'Actiepunten mailen mislukt: ' + err.message });
  }
});

app.post('/api/ai/monthly-actions', basicAuth, requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await monthlyReport.sendActions());
  } catch (err) {
    console.error('Manual monthly action items mail failed:', err.message);
    res.status(500).json({ error: 'Actiepunten mailen mislukt: ' + err.message });
  }
});

// --- AI explanation above the dashboard widgets ---
// 7 days / this month: generated automatically (at most once per 06:00 / 12:00 / 18:00
// slot, and only when someone views it). Other ranges: on-demand button, once per 3 hours.

const explainer = createExplainer({ buildAnalytics });

function resolveView(query) {
  const { rangeParam, customStart, customEnd } = resolveRangeParam(query);
  const compare = VALID_COMPARE.includes(query.compare) ? query.compare : 'previous';
  const ranges = getRanges(rangeParam, compare, customStart, customEnd);
  const viewKey = [rangeParam, compare, ranges.current.start, ranges.current.end].join('|');
  return { rangeParam, compare, ranges, viewKey };
}

app.get('/api/ai/explanation', basicAuth, async (req, res) => {
  if (!isAiConfigured()) return res.json({ mode: 'unavailable' });

  const { rangeParam, compare, ranges, viewKey } = resolveView(req.query);

  if (!AI_AUTO_RANGES.includes(rangeParam)) {
    return res.json(Object.assign({ mode: 'manual' }, explainer.manualStatus(viewKey)));
  }

  try {
    res.json(Object.assign({ mode: 'auto' }, await explainer.auto(ranges, rangeParam, compare)));
  } catch (err) {
    res.json({ mode: 'auto', error: 'De verklaring is tijdelijk niet beschikbaar.' });
  }
});

app.post('/api/ai/explanation', basicAuth, async (req, res) => {
  if (!isAiConfigured()) return res.status(400).json({ error: 'AI is nog niet ingesteld.' });

  const { rangeParam, compare, ranges, viewKey } = resolveView(req.query);
  if (AI_AUTO_RANGES.includes(rangeParam)) {
    return res.status(400).json({ error: 'Voor deze periode wordt de verklaring automatisch gemaakt.' });
  }

  try {
    res.json(Object.assign({ mode: 'manual' }, await explainer.manual(ranges, rangeParam, compare, viewKey)));
  } catch (err) {
    if (err.code === 'COOLDOWN') return res.status(429).json({ error: err.message, cooldownUntil: err.cooldownUntil });
    console.error('Manual explanation failed:', err.message);
    res.status(500).json({ error: 'Verklaring maken mislukt. Probeer het later opnieuw.' });
  }
});

// --- Serve static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Start ---
app.listen(PORT, () => {
  console.log(`White Vision Dashboard running on port ${PORT}`);
  weeklyReport.start();
  monthlyReport.start();
});
