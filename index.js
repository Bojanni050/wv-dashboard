require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const ai = require('./ai');
const { createWeeklyReport } = require('./weekly-report');

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
        stringFilter: { matchType: 'EXACT', value: 'gforms_submission' },
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
        stringFilter: { matchType: 'EXACT', value: 'gforms_submission' },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  return (response.rows || []).map((row) => ({
    channel: row.dimensionValues[0].value,
    count: parseInt(row.metricValues[0].value, 10),
  }));
}

async function fetchOfferteByCampaign(dateRange) {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionCampaignName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: 'eventName',
              stringFilter: { matchType: 'EXACT', value: 'gforms_submission' },
            },
          },
          {
            filter: {
              fieldName: 'sessionDefaultChannelGroup',
              stringFilter: { matchType: 'BEGINS_WITH', value: 'Paid' },
            },
          },
        ],
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  return (response.rows || []).map((row) => ({
    campaign: row.dimensionValues[0].value,
    count: parseInt(row.metricValues[0].value, 10),
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
    },
    channels,
    offerteByPage,
    offerteByChannel,
    offerteByCampaign,
    dailySessions,
    dailySessionsPrev,
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

// --- Google Ads (admin fills in manually, data comes from Strato rankingcoach) ---

const DATA_DIR = path.join(__dirname, 'data');
const GOOGLE_ADS_FILE = path.join(DATA_DIR, 'google-ads.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readGoogleAds() {
  ensureDataDir();
  if (!fs.existsSync(GOOGLE_ADS_FILE)) {
    return { clicks: 0, costOfClicks: 0, costPerClick: 0, updatedAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(GOOGLE_ADS_FILE, 'utf8'));
  } catch (err) {
    console.error('Google Ads data read error:', err.message);
    return { clicks: 0, costOfClicks: 0, costPerClick: 0, updatedAt: null };
  }
}

function isNonNegativeNumber(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0;
}

app.get('/api/google-ads', basicAuth, (req, res) => {
  res.json(readGoogleAds());
});

app.put('/api/google-ads', basicAuth, requireAdmin, (req, res) => {
  const { clicks, costOfClicks, costPerClick } = req.body || {};

  if (!isNonNegativeNumber(clicks) || !isNonNegativeNumber(costOfClicks) || !isNonNegativeNumber(costPerClick)) {
    return res.status(400).json({ error: 'Klikken, kosten en kost per klik moeten geldige getallen zijn (0 of hoger).' });
  }

  const entry = {
    clicks,
    costOfClicks,
    costPerClick,
    updatedAt: new Date().toISOString(),
  };

  ensureDataDir();
  fs.writeFileSync(GOOGLE_ADS_FILE, JSON.stringify(entry, null, 2));

  res.json(entry);
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

  settings.activeProvider = body.activeProvider;
  settings.weeklyReportEnabled = Boolean(body.weeklyReportEnabled);
  ai.writeSettings(settings);
  res.json(ai.publicSettings(settings));
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

app.post('/api/ai/weekly-report', basicAuth, requireAdmin, async (req, res) => {
  try {
    const result = await weeklyReport.generate();
    res.status(201).json(result);
  } catch (err) {
    console.error('Manual weekly report failed:', err.message);
    res.status(500).json({ error: 'Weekrapport maken mislukt: ' + err.message });
  }
});

// --- Serve static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Start ---
app.listen(PORT, () => {
  console.log(`White Vision Dashboard running on port ${PORT}`);
  weeklyReport.start();
});
