const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const AI_SETTINGS_FILE = path.join(DATA_DIR, 'ai-settings.json');

// Gemini speaks its native API; EdenAI and OpenRouter are OpenAI-compatible.
const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  edenai: {
    label: 'Eden AI',
    defaultBaseUrl: 'https://api.edenai.run/v3',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
};

const REQUEST_TIMEOUT_MS = 60000;

function defaultSettings() {
  const providers = {};
  Object.keys(PROVIDERS).forEach((key) => {
    providers[key] = { baseUrl: PROVIDERS[key].defaultBaseUrl, apiKey: '', model: '' };
  });
  return { activeProvider: 'gemini', providers, weeklyReportEnabled: true };
}

function readSettings() {
  const defaults = defaultSettings();
  if (!fs.existsSync(AI_SETTINGS_FILE)) return defaults;
  try {
    const saved = JSON.parse(fs.readFileSync(AI_SETTINGS_FILE, 'utf8'));
    Object.keys(PROVIDERS).forEach((key) => {
      defaults.providers[key] = Object.assign(defaults.providers[key], (saved.providers || {})[key] || {});
    });
    if (PROVIDERS[saved.activeProvider]) defaults.activeProvider = saved.activeProvider;
    if (typeof saved.weeklyReportEnabled === 'boolean') defaults.weeklyReportEnabled = saved.weeklyReportEnabled;
  } catch (err) {
    console.error('AI settings read error:', err.message);
  }
  return defaults;
}

function writeSettings(settings) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

// Settings as sent to the browser: API keys never leave the server.
function publicSettings(settings) {
  const providers = {};
  Object.keys(PROVIDERS).forEach((key) => {
    const p = settings.providers[key];
    providers[key] = { baseUrl: p.baseUrl, model: p.model, hasKey: Boolean(p.apiKey) };
  });
  return {
    activeProvider: settings.activeProvider,
    weeklyReportEnabled: settings.weeklyReportEnabled,
    providers,
    providerMeta: PROVIDERS,
  };
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Ongeldige base URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL moet met http(s):// beginnen');
  }
  return trimmed;
}

async function request(url, options) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, options));
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    // non-JSON body; fall through to the error handling below
  }
  if (!res.ok) {
    const detail = (body && (body.error && (body.error.message || body.error) || body.message || body.detail)) || text.slice(0, 200);
    throw new Error('HTTP ' + res.status + (detail ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
  return body;
}

function authHeaders(provider, apiKey) {
  if (provider === 'gemini') return { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
  return { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
}

// Returns [{ id, name }] sorted by id.
async function listModels(provider, baseUrl, apiKey) {
  if (!PROVIDERS[provider]) throw new Error('Onbekende provider');
  if (!apiKey) throw new Error('Geen API-key ingesteld');
  const base = normalizeBaseUrl(baseUrl);
  const body = await request(base + '/models' + (provider === 'gemini' ? '?pageSize=1000' : ''), {
    headers: authHeaders(provider, apiKey),
  });

  let models;
  if (provider === 'gemini') {
    models = (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || m.name }));
  } else {
    const list = Array.isArray(body) ? body : body.data || body.models || [];
    models = list.map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: m.id || m.model || m.name, name: m.name || m.id || m.model }));
  }

  return models
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Sends one prompt to the active provider and returns the plain-text reply.
async function generateText(settings, systemPrompt, userPrompt) {
  const provider = settings.activeProvider;
  const cfg = settings.providers[provider];
  if (!cfg || !cfg.apiKey) throw new Error('Geen API-key ingesteld voor ' + PROVIDERS[provider].label);
  if (!cfg.model) throw new Error('Geen model gekozen voor ' + PROVIDERS[provider].label);
  const base = normalizeBaseUrl(cfg.baseUrl);

  if (provider === 'gemini') {
    const body = await request(base + '/models/' + encodeURIComponent(cfg.model) + ':generateContent', {
      method: 'POST',
      headers: authHeaders(provider, cfg.apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
    });
    const parts = (body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('Leeg antwoord van Gemini');
    return text;
  }

  const body = await request(base + '/chat/completions', {
    method: 'POST',
    headers: authHeaders(provider, cfg.apiKey),
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const text = String((body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '').trim();
  if (!text) throw new Error('Leeg antwoord van ' + PROVIDERS[provider].label);
  return text;
}

module.exports = {
  PROVIDERS,
  readSettings,
  writeSettings,
  publicSettings,
  normalizeBaseUrl,
  listModels,
  generateText,
};
