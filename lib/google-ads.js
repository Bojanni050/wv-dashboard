// Google Ads figures via Windsor.ai (https://connectors.windsor.ai/google_ads).
// The Google Ads account is connected once in the Windsor UI (OAuth); here we
// only need the API key and, optionally, the Ads account id. This replaces the
// old manual admin input for the Google Ads tab and the weekly/monthly reports.
//
// Two queries, each cached briefly so the dashboard and the reports sharing the
// same range don't hit the connector every time:
//   - fetchRange:           metrics for one date range (the tab's KPI tiles).
//   - fetchCampaignOverview: per-campaign lifetime totals + status/flight dates,
//                            to split campaigns into running vs closed.

const { amsterdamNow } = require('./dates');

const BASE_URL = 'https://connectors.windsor.ai/google_ads';
const FIELDS = 'date,campaign,clicks,spend,impressions';
const OVERVIEW_FIELDS = 'campaign,campaign_status,start_date,end_date,clicks,spend,impressions';
// How far back the overview looks. Google Ads reports since the account opened;
// override if the connector's plan caps history (Windsor may limit on free plans).
const HISTORY_FROM = process.env.WINDSOR_GOOGLE_ADS_FROM || '2019-01-01';
const INDEFINITE_END = '2037-12-30'; // Google's sentinel for "runs indefinitely"
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map(); // cacheKey -> { at, value }

function config() {
  const apiKey = String(process.env.WINDSOR_API_KEY || '').trim();
  // Windsor expects the account id with dashes, e.g. 307-043-6491.
  const account = String(process.env.WINDSOR_GOOGLE_ADS_ACCOUNT || '').replace(/\s+/g, '').trim();
  return { apiKey, account };
}

function isConfigured() {
  return Boolean(config().apiKey);
}

// Windsor may return numbers as strings ("524" or "276,17").
function toNumber(value) {
  const n = Number(String(value == null ? '' : value).replace(',', '.'));
  return isFinite(n) ? n : 0;
}

// Normalises a DATE field to 'YYYY-MM-DD', dropping any time part.
function toDate(value) {
  const s = String(value == null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.result)) return payload.result;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function campaignName(row) {
  return String(row.campaign || row.campaign_name || row['campaign.name'] || '(geen campagne)');
}

function withCpc(entry) {
  return Object.assign({}, entry, {
    costPerClick: entry.clicks > 0 ? entry.costOfClicks / entry.clicks : 0,
  });
}

// Collapses rows into totals plus a per-campaign list. Works both for per-day
// rows (fetchRange) and for one aggregated row per campaign (overview).
function summarize(rows) {
  const totals = { clicks: 0, impressions: 0, costOfClicks: 0 };
  const byCampaign = new Map();

  rows.forEach((row) => {
    const clicks = toNumber(row.clicks);
    const impressions = toNumber(row.impressions);
    const spend = toNumber(row.spend);

    totals.clicks += clicks;
    totals.impressions += impressions;
    totals.costOfClicks += spend;

    const name = campaignName(row);
    const c = byCampaign.get(name) || {
      campaign: name,
      clicks: 0,
      impressions: 0,
      costOfClicks: 0,
      status: undefined,
      startDate: undefined,
      endDate: undefined,
    };
    c.clicks += clicks;
    c.impressions += impressions;
    c.costOfClicks += spend;
    if (!c.status && row.campaign_status) c.status = String(row.campaign_status).toUpperCase();
    if (!c.startDate) c.startDate = toDate(row.start_date);
    if (!c.endDate) c.endDate = toDate(row.end_date);
    byCampaign.set(name, c);
  });

  const campaigns = Array.from(byCampaign.values()).map(withCpc);
  return Object.assign(withCpc(totals), { campaigns });
}

async function request(params) {
  const { apiKey, account } = config();
  const qs = new URLSearchParams(Object.assign({ api_key: apiKey, _renderer: 'json' }, params));
  if (account) qs.set('select_accounts', account);

  const res = await fetch(BASE_URL + '?' + qs.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error('Windsor Google Ads request failed (HTTP ' + res.status + ')');
  }

  const payload = await res.json();
  if (payload && payload.error) {
    throw new Error('Windsor Google Ads error: ' + payload.error);
  }
  return extractRows(payload);
}

function readCache(key, options) {
  const cached = cache.get(key);
  if (cached && !(options && options.force) && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  return undefined;
}

function writeCache(key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

// range is { start, end } (both 'YYYY-MM-DD', inclusive). Returns null when the
// connector is not configured, so the caller can fall back.
async function fetchRange(range, options) {
  const { apiKey, account } = config();
  if (!apiKey) return null;

  const start = range && range.start ? range.start : '';
  const end = range && range.end ? range.end : '';
  const cacheKey = start + '..' + end + '|' + account;
  const cached = readCache(cacheKey, options);
  if (cached) return cached;

  const rows = await request({ date_from: start, date_to: end, fields: FIELDS });
  const value = Object.assign(summarize(rows), {
    from: start,
    to: end,
    source: 'windsor',
    updatedAt: new Date().toISOString(),
  });
  return writeCache(cacheKey, value);
}

// Per-campaign lifetime totals plus status and flight dates, aggregated over the
// whole history in one row per campaign (no `date` field, so Windsor aggregates).
async function fetchCampaignOverview(options) {
  const { apiKey, account } = config();
  if (!apiKey) return null;

  const today = amsterdamNow(new Date()).date;
  const cacheKey = 'overview|' + HISTORY_FROM + '..' + today + '|' + account;
  const cached = readCache(cacheKey, options);
  if (cached) return cached;

  const rows = await request({ date_from: HISTORY_FROM, date_to: today, fields: OVERVIEW_FIELDS });
  const value = {
    campaigns: summarize(rows).campaigns,
    from: HISTORY_FROM,
    to: today,
    source: 'windsor',
    updatedAt: new Date().toISOString(),
  };
  return writeCache(cacheKey, value);
}

// A campaign runs now when Google reports it ENABLED and it hasn't ended.
function isRunning(campaign, today) {
  const end = campaign.endDate;
  const indefinite = !end || end === INDEFINITE_END;
  return campaign.status === 'ENABLED' && (indefinite || end >= today);
}

// Splits the overview into running and closed campaigns. `today` is 'YYYY-MM-DD'.
function classifyCampaigns(campaigns, today) {
  const active = [];
  const closed = [];
  (campaigns || []).forEach((c) => {
    if (isRunning(c, today)) active.push(c);
    else closed.push(c);
  });
  active.sort((a, b) => b.costOfClicks - a.costOfClicks);
  closed.sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')));
  return { active, closed };
}

module.exports = { fetchRange, fetchCampaignOverview, classifyCampaigns, isConfigured, config };
