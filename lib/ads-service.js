// Google Ads rows from the self-hosted analytics service (the same service the
// Adlytica desktop app talks to): POST {base}/query with a bearer token.
//
// Auth is the service's own OAuth (public client, PKCE, no client secret), so a
// headless server only needs the refresh token and client id that one Adlytica
// login produces (Adlytica: config.json -> credentials). From those we fetch
// short-lived access tokens via the standard refresh_token grant.
//
// If the service rotates the refresh token, the new one is stored encrypted in
// data/ads-service-token.json. That file only wins while the env token it was
// derived from is unchanged, so pasting a fresh token in .env always takes over.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const DEFAULT_BASE_URL = 'https://analytics.studiovanderheide.nl';
const TOKEN_FILE = path.join(__dirname, '..', 'data', 'ads-service-token.json');
const EXPIRY_MARGIN_MS = 60 * 1000;

let access = { token: '', expiresAt: 0 };
let refreshing = null;

function config() {
  return {
    baseUrl: String(process.env.ADS_SERVICE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    refreshToken: String(process.env.ADS_SERVICE_REFRESH_TOKEN || '').trim(),
    clientId: String(process.env.ADS_SERVICE_CLIENT_ID || '').trim(),
    account: String(process.env.GOOGLE_ADS_ACCOUNT || process.env.WINDSOR_GOOGLE_ADS_ACCOUNT || '')
      .replace(/\s+/g, '')
      .trim(),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.refreshToken && c.clientId && c.account);
}

function fingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// The refresh token to use: a rotated one from disk if it belongs to the
// current env token, otherwise the env token itself.
function currentRefreshToken() {
  const { refreshToken } = config();
  try {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (saved.origin === fingerprint(refreshToken)) {
      const rotated = decrypt(saved.refresh);
      if (rotated) return rotated;
    }
  } catch (err) {
    // No saved token (or unreadable): fall through to the env value.
  }
  return refreshToken;
}

function saveRotatedToken(newToken) {
  const { refreshToken } = config();
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ origin: fingerprint(refreshToken), refresh: encrypt(newToken) }),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error('Kon vernieuwd Ads-refresh-token niet bewaren:', err.message);
  }
}

async function fetchJson(url, init, what) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(what + ': geen verbinding (' + err.message + ')');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(what + ': HTTP ' + res.status + ' ' + text.slice(0, 200));
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(what + ': onverwacht antwoord');
  }
}

async function doRefresh() {
  const { baseUrl, clientId } = config();
  const meta = await fetchJson(
    baseUrl + '/.well-known/oauth-authorization-server',
    { headers: { Accept: 'application/json' } },
    'Ads-service metadata'
  );
  if (!meta.token_endpoint) throw new Error('Ads-service metadata mist token_endpoint');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken(),
    client_id: clientId,
  });
  const token = await fetchJson(
    meta.token_endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    },
    'Ads-service token vernieuwen'
  );
  if (!token.access_token) throw new Error('Ads-service gaf geen access_token');

  const ttlMs = (Number(token.expires_in) > 0 ? Number(token.expires_in) : 3600) * 1000;
  access = { token: token.access_token, expiresAt: Date.now() + ttlMs - EXPIRY_MARGIN_MS };
  if (token.refresh_token && token.refresh_token !== currentRefreshToken()) {
    saveRotatedToken(token.refresh_token);
  }
  return access.token;
}

// One refresh at a time, so parallel dashboard calls don't each rotate the token.
function refreshAccessToken() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function accessToken() {
  if (access.token && Date.now() < access.expiresAt) return access.token;
  return refreshAccessToken();
}

async function post(pathname, body) {
  const { baseUrl } = config();
  const send = async (token) =>
    fetch(baseUrl + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });

  let res = await send(await accessToken());
  if (res.status === 401) res = await send(await refreshAccessToken());

  const text = await res.text();
  if (!res.ok) throw new Error('Ads-service request mislukt: HTTP ' + res.status + ' ' + text.slice(0, 200));
  const payload = JSON.parse(text);
  if (payload && payload.error) throw new Error('Ads-service fout: ' + JSON.stringify(payload.error));
  return payload;
}

// Per-day, per-campaign rows in the shape lib/google-ads.js already summarizes
// (date, campaign, campaign_status, clicks, spend, impressions). Paused and
// removed campaigns are included so the running/closed split still works.
async function fetchRows(start, end) {
  const { account } = config();
  const payload = await post('/query', {
    connector: 'google_ads',
    account,
    fields: ['date', 'campaign_name', 'status', 'spend', 'clicks', 'impressions'],
    date_from: start,
    date_to: end,
    group_by: [],
    options: { include_inactive: 'true' },
    limit: 50000,
  });
  const rows = Array.isArray(payload && payload.data) ? payload.data : [];
  return rows.map((r) => ({
    date: r.date,
    campaign: r.campaign_name,
    campaign_status: r.status,
    clicks: r.clicks,
    spend: r.spend,
    impressions: r.impressions,
  }));
}

module.exports = { isConfigured, fetchRows, config };
