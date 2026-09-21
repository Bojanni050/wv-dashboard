const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ai = require('./ai');

const STATE_FILE = path.join(__dirname, 'data', 'weekly-report-state.json');
const TIMEZONE = 'Europe/Amsterdam';
const RUN_AFTER_HOUR = 7; // Amsterdam time, on Mondays
const RETRY_AFTER_MS = 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

const GOLD = '#a8894b';
const INK = '#1a1a1a';
const MUTED = '#666666';
const LINE = '#dddddd';

// --- Dates (all in Amsterdam time; the container itself runs in UTC) ---

function amsterdamNow(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    hour: parseInt(get('hour'), 10) % 24,
    weekday: get('weekday'), // 'Mon'..'Sun'
  };
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing dateStr
function mondayOf(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  return shiftDate(dateStr, -((dow + 6) % 7));
}

// The last complete Monday–Sunday week, plus the week before it for comparison.
function lastWeekRanges(now) {
  const monday = mondayOf(amsterdamNow(now).date);
  return {
    weekKey: monday,
    current: { start: shiftDate(monday, -7), end: shiftDate(monday, -1) },
    previous: { start: shiftDate(monday, -14), end: shiftDate(monday, -8) },
  };
}

function nlDate(dateStr, withYear) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

function nlWeekday(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'short', timeZone: 'UTC' });
}

// --- State ---

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

// --- AI intro ---

const SYSTEM_PROMPT =
  'Je schrijft de inleiding van een wekelijks webstatistiekenrapport voor White Vision, een Nederlands bedrijf. ' +
  'De lezer is een ondernemer zonder technische achtergrond. Schrijf in helder, vriendelijk Nederlands, in de wij/jullie-vorm waar dat past. ' +
  'Leg in gewone woorden uit wat de cijfers van afgelopen week betekenen: wat gaat goed, wat valt op en wat is de belangrijkste les. ' +
  'Gebruik alleen de aangeleverde cijfers en verzin niets. Noem geen oorzaken die je niet uit de data kunt afleiden; formuleer die dan als mogelijke verklaring. ' +
  'Schrijf 120 tot 200 woorden in 2 tot 3 alinea\'s, zonder kopjes, opsommingstekens, markdown of emoji.';

function buildPromptData(data, ranges, googleAds) {
  const k = data.kpis;
  const kpi = (key) => ({ dezeWeek: k[key].current, vorigeWeek: k[key].previous, veranderingPct: k[key].change });
  return {
    periode: { van: ranges.current.start, tot: ranges.current.end },
    vergelijkingsperiode: { van: ranges.previous.start, tot: ranges.previous.end },
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
    googleAdsHandmatigIngevuld: googleAds && googleAds.updatedAt ? googleAds : undefined,
  };
}

function fallbackIntro(data, ranges) {
  const k = data.kpis;
  const dir = (c) => (c > 0 ? 'een stijging van ' + c + '%' : c < 0 ? 'een daling van ' + Math.abs(c) + '%' : 'gelijk gebleven');
  return (
    'Dit is het overzicht van de website van ' + nlDate(ranges.current.start) + ' tot en met ' + nlDate(ranges.current.end, true) + '. ' +
    'De site kreeg ' + k.sessions.current + ' sessies (' + dir(k.sessions.change) + ' ten opzichte van de week ervoor) ' +
    'en er zijn ' + k.offertes.current + ' offerteaanvragen binnengekomen (' + dir(k.offertes.change) + '). ' +
    'Hieronder vind je de details per kanaal, pagina en campagne.'
  );
}

// PDFKit's built-in fonts only cover Latin-1, so strip markdown and anything outside it.
function cleanText(text) {
  return String(text)
    .replace(/[*_`#>]+/g, '')
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\n\x20-\x7E -ÿ€]/g, '')
    .trim();
}

async function writeIntro(data, ranges, googleAds) {
  const settings = ai.readSettings();
  try {
    const text = await ai.generateText(
      settings,
      SYSTEM_PROMPT,
      'Cijfers als JSON:\n' + JSON.stringify(buildPromptData(data, ranges, googleAds), null, 2)
    );
    return { text: cleanText(text), ai: true };
  } catch (err) {
    console.error('Weekly report AI intro failed, using fallback:', err.message);
    return { text: fallbackIntro(data, ranges), ai: false, error: err.message };
  }
}

// --- PDF ---

const fmtNum = (n) => new Intl.NumberFormat('nl-NL').format(n);
const fmtPct = (n) => n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const fmtChange = (c) => (c > 0 ? '+' : '') + c + '%';

function renderPdf(data, ranges, intro) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'White Vision weekrapport', Author: 'White Vision Dashboard' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensureSpace = (h) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    // Header
    const logoPath = path.join(__dirname, 'public', 'logo-mark.png');
    if (fs.existsSync(logoPath)) doc.image(logoPath, left, 45, { height: 42 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Weekrapport', left + 40, 48);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text('White Vision - ' + nlDate(ranges.current.start) + ' t/m ' + nlDate(ranges.current.end, true), left + 40, 72);
    doc.moveTo(left, 100).lineTo(left + width, 100).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.y = 118;

    const heading = (text) => {
      ensureSpace(60);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(GOLD).text(text, left, doc.y);
      doc.moveDown(0.4);
    };

    // Intro
    intro.text.split(/\n{2,}|\n/).filter(Boolean).forEach((para) => {
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(para, left, doc.y, { width, lineGap: 3 });
      doc.moveDown(0.6);
    });

    // Simple table: columns = [{ label, width, align }]
    const table = (columns, rows) => {
      const rowH = 20;
      const drawRow = (cells, header) => {
        ensureSpace(rowH);
        const y = doc.y;
        let x = left;
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 9 : 10);
        cells.forEach((cell, i) => {
          const col = columns[i];
          const text = typeof cell === 'object' ? cell.text : cell;
          doc.fillColor(typeof cell === 'object' && cell.color ? cell.color : header ? MUTED : INK)
            .text(String(text), x + 4, y + 5, { width: col.width - 8, align: col.align || 'left', lineBreak: false, ellipsis: true });
          x += col.width;
        });
        doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.y = y + rowH;
      };
      drawRow(columns.map((c) => c.label), true);
      if (!rows.length) drawRow([{ text: 'Geen gegevens in deze periode', color: MUTED }].concat(columns.slice(1).map(() => '')), false);
      rows.forEach((r) => drawRow(r, false));
    };

    // KPIs
    const k = data.kpis;
    const changeCell = (c) => ({ text: fmtChange(c), color: c > 0 ? '#2e7d32' : c < 0 ? '#c62828' : MUTED });
    const kpiRows = [
      ['Sessies', 'sessions', fmtNum],
      ['Gebruikers', 'users', fmtNum],
      ['Paginaweergaven', 'pageviews', fmtNum],
      ['Offerteaanvragen', 'offertes', fmtNum],
      ['Bezoekers via Paid Ads', 'paidAds', fmtNum],
      ['Bezoekers via Social', 'social', fmtNum],
      ['Bezoekers via Search', 'search', fmtNum],
      ['Bezoekers overig', 'overig', fmtNum],
      ['Conversie totaal', 'conversionTotal', fmtPct],
      ['Conversie betaalde bezoekers', 'conversionPaid', fmtPct],
      ['Conversie socials', 'conversionSocial', fmtPct],
    ].map(([label, key, fmt]) => [label, fmt(k[key].current), fmt(k[key].previous), changeCell(k[key].change)]);

    heading('Kerncijfers');
    table(
      [
        { label: 'Meting', width: width - 3 * 100 },
        { label: 'Deze week', width: 100, align: 'right' },
        { label: 'Vorige week', width: 100, align: 'right' },
        { label: 'Verschil', width: 100, align: 'right' },
      ],
      kpiRows
    );

    // Daily sessions bar chart
    heading('Sessies per dag');
    const days = data.dailySessions;
    const prevDays = data.dailySessionsPrev;
    const chartH = 110;
    ensureSpace(chartH + 50);
    const chartTop = doc.y + 6;
    const max = Math.max(1, ...days.map((d) => d.sessions), ...prevDays.map((d) => d.sessions));
    const slot = width / days.length;
    const barW = Math.min(18, slot / 2 - 3);
    days.forEach((d, i) => {
      const cx = left + slot * i + slot / 2;
      const h = (d.sessions / max) * chartH;
      const ph = ((prevDays[i] ? prevDays[i].sessions : 0) / max) * chartH;
      doc.rect(cx - barW - 1, chartTop + chartH - ph, barW, ph).fill('#cfcfcf');
      doc.rect(cx + 1, chartTop + chartH - h, barW, h).fill(GOLD);
      doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(String(d.sessions), cx - slot / 2, chartTop + chartH - h - 11, { width: slot, align: 'center', lineBreak: false });
      doc.fillColor(MUTED).text(nlWeekday(d.date), cx - slot / 2, chartTop + chartH + 4, { width: slot, align: 'center', lineBreak: false });
    });
    doc.y = chartTop + chartH + 20;
    doc.rect(left, doc.y + 2, 8, 8).fill(GOLD);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Deze week', left + 12, doc.y, { lineBreak: false });
    doc.rect(left + 80, doc.y + 2, 8, 8).fill('#cfcfcf');
    doc.fillColor(MUTED).text('Vorige week', left + 92, doc.y, { lineBreak: false });
    doc.y += 14;

    // Channels + offerte tables
    const total = data.channels.reduce((s, c) => s + c.sessions, 0);
    heading('Sessies per kanaal');
    table(
      [
        { label: 'Kanaal', width: width - 200 },
        { label: 'Sessies', width: 100, align: 'right' },
        { label: 'Aandeel', width: 100, align: 'right' },
      ],
      data.channels.map((c) => [c.channel, fmtNum(c.sessions), total ? Math.round((c.sessions / total) * 100) + '%' : '0%'])
    );

    const countTable = (title, labelHead, rows, key) => {
      heading(title);
      table(
        [{ label: labelHead, width: width - 100 }, { label: 'Aantal', width: 100, align: 'right' }],
        rows.map((r) => [r[key], fmtNum(r.count)])
      );
    };
    countTable('Offerteaanvragen per pagina', 'Pagina', data.offerteByPage, 'page');
    countTable('Offerteaanvragen per kanaal', 'Kanaal', data.offerteByChannel, 'channel');
    countTable('Offerteaanvragen per campagne (betaalde ads)', 'Campagne', data.offerteByCampaign, 'campaign');

    // Footer note
    doc.moveDown(1.5);
    ensureSpace(30);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      'Bron: Google Analytics 4. ' + (intro.ai ? 'De inleiding is geschreven met behulp van AI.' : '') +
      ' Gegenereerd op ' + new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIMEZONE }) + '.',
      left, doc.y, { width }
    );

    doc.end();
  });
}

// --- Orchestration ---

function createWeeklyReport({ buildAnalytics, readGoogleAds, saveReport }) {
  let running = false;

  async function generate(now) {
    if (running) throw new Error('Er wordt al een weekrapport gemaakt');
    running = true;
    try {
      const ranges = lastWeekRanges(now || new Date());
      const data = await buildAnalytics({ current: ranges.current, previous: ranges.previous }, 'custom', 'previous');
      const intro = await writeIntro(data, ranges, readGoogleAds());
      const buffer = await renderPdf(data, ranges, intro);
      const entry = saveReport(buffer, 'Weekrapport ' + ranges.current.start + ' t-m ' + ranges.current.end + '.pdf');
      return { entry, weekKey: ranges.weekKey, aiUsed: intro.ai, aiError: intro.error };
    } finally {
      running = false;
    }
  }

  async function tick() {
    const settings = ai.readSettings();
    if (!settings.weeklyReportEnabled) return;

    const now = new Date();
    const local = amsterdamNow(now);
    if (local.weekday !== 'Mon' || local.hour < RUN_AFTER_HOUR) return;

    const weekKey = mondayOf(local.date);
    const state = readState();
    if (state.lastWeek === weekKey) return;
    if (state.lastAttemptAt && now - new Date(state.lastAttemptAt) < RETRY_AFTER_MS) return;

    writeState(Object.assign(state, { lastAttemptAt: now.toISOString() }));
    try {
      const result = await generate(now);
      writeState({ lastWeek: weekKey, lastAttemptAt: now.toISOString(), lastReportId: result.entry.id });
      console.log('Weekly report generated for week ' + weekKey + (result.aiUsed ? '' : ' (without AI intro)'));
    } catch (err) {
      console.error('Weekly report failed:', err.message);
    }
  }

  function start() {
    setInterval(tick, TICK_MS);
    setTimeout(tick, 15000);
  }

  return { generate, start };
}

module.exports = { createWeeklyReport, lastWeekRanges, amsterdamNow, mondayOf };
