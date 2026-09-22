const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const { amsterdamNow, shiftDate, cleanText, stripGreetings } = require('./weekly-report');

const STATE_FILE = path.join(__dirname, 'data', 'ai-explanations.json');

// Ranges that get an automatic explanation, refreshed at 06:00, 12:00 and 18:00
// (Amsterdam) when someone looks at them. All other ranges use the rate-limited
// button.
const AUTO_RANGES = ['7', 'month'];
const MANUAL_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

const RANGE_LABELS = { today: 'vandaag', yesterday: 'gisteren', '7': 'de afgelopen 7 dagen', '90': 'de afgelopen 90 dagen', month: 'deze maand (tot en met vandaag)', custom: 'de gekozen periode' };
const COMPARE_LABELS = { previous: 'de periode direct ervoor (even lang)', year: 'dezelfde periode een jaar eerder' };

const SYSTEM_PROMPT =
  'Je schrijft een korte toelichting boven een webstatistiekendashboard van White Vision, een Nederlands bedrijf. ' +
  'De lezer is een ondernemer zonder technische achtergrond. Schrijf helder, vriendelijk Nederlands. ' +
  'Leg in gewone woorden uit wat de cijfers van de gekozen periode betekenen: wat gaat goed, wat valt op en waar moet je op letten. ' +
  'Vergelijk met de opgegeven vergelijkingsperiode. De huidige periode kan nog onvolledig zijn (vandaag loopt nog); trek dus geen harde conclusies uit kleine aantallen. ' +
  'Gebruik alleen de aangeleverde cijfers en verzin niets. Noem geen oorzaken die je niet uit de data kunt afleiden; formuleer die dan als mogelijke verklaring. ' +
  'Begin direct met de inhoud: geen aanhef en geen afsluitende groet. ' +
  'Schrijf 60 tot 120 woorden in 1 tot 2 alinea\'s, zonder kopjes, opsommingstekens, markdown of emoji.';

// Appended to SYSTEM_PROMPT only by the automatic 06:00/12:00/18:00 generation on 22 September.
const BIRTHDAY_PROMPT =
  ' Vandaag is 22 september: de verjaardag van Bas, de eigenaar van White Vision. ' +
  'Begin je toelichting daarom met één korte, warme felicitatie voor Bas, bijvoorbeeld: "Gefeliciteerd met je verjaardag, Bas!". ' +
  'Schrijf geen aanhef zoals "Beste Bas" en plaats de felicitatie niet als losse afsluiter: ' +
  'werk hem aan het begin van je eerste alinea en ga daarna gewoon verder met de uitleg van de cijfers.';

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Automatic refresh moments, in Amsterdam time.
const SLOT_HOURS = [6, 12, 18];

// Identifies the most recent 06:00 / 12:00 / 18:00 Amsterdam boundary. An
// explanation generated in an earlier slot is stale.
function currentSlotKey(now) {
  const local = amsterdamNow(now);
  for (let i = SLOT_HOURS.length - 1; i >= 0; i--) {
    if (local.hour >= SLOT_HOURS[i]) return local.date + 'T' + String(SLOT_HOURS[i]).padStart(2, '0');
  }
  // Before the first slot of the day we are still in yesterday's last slot.
  return shiftDate(local.date, -1) + 'T' + String(SLOT_HOURS[SLOT_HOURS.length - 1]).padStart(2, '0');
}

// Bas (eigenaar van White Vision) is jarig op 22 september. Alleen de
// automatische 06:00/12:00/18:00-generatie van die dag feliciteert hem; de
// handmatige knop en het weekrapport dus niet. Voor 06:00 hoort een
// weergave nog bij het avondslot van de dag ervoor, dus dan ook niet.
const BIRTHDAY_MONTH_DAY = '09-22';

function birthdayGreetingDue(now) {
  const local = amsterdamNow(now || new Date());
  return local.hour >= SLOT_HOURS[0] && local.date.slice(5) === BIRTHDAY_MONTH_DAY;
}

function isConfigured() {
  const settings = ai.readSettings();
  const cfg = settings.providers[settings.activeProvider];
  return Boolean(cfg && cfg.apiKey && cfg.model);
}

function promptData(data, ranges, rangeParam, compare) {
  const k = data.kpis;
  const kpi = (key) => ({ dezePeriode: k[key].current, vergelijking: k[key].previous, veranderingPct: k[key].change });
  return {
    periode: { label: RANGE_LABELS[rangeParam], van: ranges.current.start, tot: ranges.current.end },
    vergelijkingsperiode: { label: COMPARE_LABELS[compare], van: ranges.previous.start, tot: ranges.previous.end },
    sessies: kpi('sessions'),
    gebruikers: kpi('users'),
    paginaweergaven: kpi('pageviews'),
    offerteaanvragen: kpi('offertes'),
    bezoekersViaPaidAds: kpi('paidAds'),
    bezoekersViaSocial: kpi('social'),
    bezoekersViaSearch: kpi('search'),
    bezoekersOverig: kpi('overig'),
    conversiePercentageTotaal: kpi('conversionTotal'),
    conversiePercentageBetaald: kpi('conversionPaid'),
    conversiePercentageSocial: kpi('conversionSocial'),
    kanalen: data.channels.slice(0, 6),
    offertesPerPagina: data.offerteByPage.slice(0, 5),
    offertesPerCampagne: data.offerteByCampaign.slice(0, 5),
    sessiesPerDag: data.dailySessions.map((d) => d.date + ': ' + d.sessions),
  };
}

async function generate(buildAnalytics, ranges, rangeParam, compare, birthday) {
  const data = await buildAnalytics(ranges, rangeParam, compare);
  const systemPrompt = birthday ? SYSTEM_PROMPT + BIRTHDAY_PROMPT : SYSTEM_PROMPT;
  const text = await ai.generateText(
    ai.readSettings(),
    systemPrompt,
    'Cijfers als JSON:\n' + JSON.stringify(promptData(data, ranges, rangeParam, compare), null, 2)
  );
  return ensureBirthdayGreeting(stripGreetings(cleanText(text)), birthday);
}

// The model occasionally ignores the felicitatie-instructie; then add one ourselves,
// so the greeting is guaranteed. Also runs after stripGreetings, which can remove an
// opening paragraph that happens to start with "Hallo"/"Beste".
function ensureBirthdayGreeting(text, birthday) {
  if (!birthday) return text;
  if (/gefeliciteerd|gefeliciteer|verjaardag|\bjarig\b/i.test(text)) return text;
  return 'Gefeliciteerd met je verjaardag, Bas! ' + text;
}

function createExplainer({ buildAnalytics }) {
  const inflight = new Map();
  const failedAt = new Map();
  let manualRunning = false;

  // Explanation for a 7-day / this-month view. Generated lazily the first time
  // someone views it after a 06:00 / 12:00 / 18:00 boundary, then served from cache.
  async function auto(ranges, rangeParam, compare, now) {
    now = now || new Date();
    const key = rangeParam + ':' + compare;
    const slotKey = currentSlotKey(now);
    const entry = (readState().auto || {})[key];

    if (entry && entry.slotKey === slotKey) return { text: entry.text, generatedAt: entry.generatedAt };
    if (inflight.has(key)) return inflight.get(key);

    const recentFailure = failedAt.get(key);
    if (recentFailure && now - recentFailure.at < FAILURE_BACKOFF_MS) {
      if (entry) return { text: entry.text, generatedAt: entry.generatedAt, stale: true };
      throw new Error(recentFailure.message);
    }

    const birthday = birthdayGreetingDue(now);
    const promise = (async () => {
      try {
        const text = await generate(buildAnalytics, ranges, rangeParam, compare, birthday);
        const fresh = { slotKey, text, generatedAt: new Date().toISOString() };
        const state = readState();
        state.auto = Object.assign(state.auto || {}, { [key]: fresh });
        writeState(state);
        failedAt.delete(key);
        return { text: fresh.text, generatedAt: fresh.generatedAt };
      } catch (err) {
        console.error('AI explanation failed:', err.message);
        failedAt.set(key, { at: now, message: err.message });
        if (entry) return { text: entry.text, generatedAt: entry.generatedAt, stale: true };
        throw err;
      }
    })().finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  // State for the on-demand button: when it is available again, plus the last
  // text if it was written for this exact view.
  function manualStatus(viewKey, now) {
    now = now || new Date();
    const manual = readState().manual;
    if (!manual) return { cooldownUntil: null, text: null };
    const until = new Date(manual.lastUsedAt).getTime() + MANUAL_COOLDOWN_MS;
    return {
      cooldownUntil: until > now.getTime() ? new Date(until).toISOString() : null,
      text: manual.viewKey === viewKey ? manual.text : null,
      generatedAt: manual.viewKey === viewKey ? manual.lastUsedAt : null,
    };
  }

  // The cooldown is global (not per user) and only starts after a successful generation.
  async function manual(ranges, rangeParam, compare, viewKey, now) {
    now = now || new Date();
    const status = manualStatus(viewKey, now);
    if (status.cooldownUntil || manualRunning) {
      const err = new Error('De verklaring kan maar 1x per 3 uur worden gevraagd.');
      err.code = 'COOLDOWN';
      err.cooldownUntil = status.cooldownUntil;
      throw err;
    }

    manualRunning = true;
    try {
      const text = await generate(buildAnalytics, ranges, rangeParam, compare);
      const lastUsedAt = new Date().toISOString();
      const state = readState();
      state.manual = { lastUsedAt, viewKey, text };
      writeState(state);
      return {
        text,
        generatedAt: lastUsedAt,
        cooldownUntil: new Date(new Date(lastUsedAt).getTime() + MANUAL_COOLDOWN_MS).toISOString(),
      };
    } finally {
      manualRunning = false;
    }
  }

  return { auto, manual, manualStatus };
}

module.exports = { createExplainer, isConfigured, AUTO_RANGES, currentSlotKey, birthdayGreetingDue };
