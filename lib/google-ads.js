// Google Ads figures via Windsor.ai (https://connectors.windsor.ai/google_ads).
// The Google Ads account is connected once in the Windsor UI (OAuth); here we
// only need the API key and, optionally, the Ads account id. This replaces the
// old manual admin input for the Google Ads tab and the weekly/monthly reports.
//
// One HTTP call per date range, cached briefly so the dashboard tab and the
// reports sharing the same range don't hit the connector every time.

const BASE_URL = 'https://connectors.windsor.ai/google_ads';
const FIELDS = 'date,campaign,clicks,spend,impressions';
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

// Collapses the per-date-per-campaign rows into totals plus a per-campaign list.
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
    const c = byCampaign.get(name) || { campaign: name, clicks: 0, impressions: 0, costOfClicks: 0 };
    c.clicks += clicks;
    c.impressions += impressions;
    c.costOfClicks += spend;
    byCampaign.set(name, c);
  });

  const campaigns = Array.from(byCampaign.values())
    .map(withCpc)
    .sort((a, b) => b.costOfClicks - a.costOfClicks);

  return Object.assign(withCpc(totals), { campaigns });
}

// range is { start, end } (both 'YYYY-MM-DD', inclusive). Returns null when the
// connector is not configured, so the caller can fall back.
async function fetchRange(range, options) {
  const { apiKey, account } = config();
  if (!apiKey) return null;

  const start = range && range.start ? range.start : '';
  const end = range && range.end ? range.end : '';
  const cacheKey = start + '..' + end + '|' + account;

  const cached = cache.get(cacheKey);
  if (cached && !(options && options.force) && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    date_from: start,
    date_to: end,
    fields: FIELDS,
    _renderer: 'json',
  });
  if (account) params.set('select_accounts', account);

  const res = await fetch(BASE_URL + '?' + params.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error('Windsor Google Ads request failed (HTTP ' + res.status + ')');
  }

  const payload = await res.json();
  if (payload && payload.error) {
    throw new Error('Windsor Google Ads error: ' + payload.error);
  }

  const value = Object.assign(summarize(extractRows(payload)), {
    from: start,
    to: end,
    source: 'windsor',
    updatedAt: new Date().toISOString(),
  });

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

module.exports = { fetchRange, isConfigured, config };
