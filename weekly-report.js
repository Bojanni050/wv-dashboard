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
  'Begin direct met de inhoud: geen aanhef (zoals "Beste" of "Hallo") en geen afsluitende groet, ondertekening of slotzin als "Met vriendelijke groet". ' +
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

// Strip markdown, and characters the embedded fonts lack (emoji, CJK, ...).
function cleanText(text) {
  return String(text)
    .replace(/[*_`#>]+/g, '')
    .replace(/[^\n\x20-\x7E\u00A0-\u024F\u2010-\u203A\u20AC]/g, '')
    .trim();
}

// Models sometimes add a salutation or sign-off despite the prompt; drop those paragraphs.
function stripGreetings(text) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const isOpening = (p) => /^(beste|geachte|hallo|hoi|hi|goedemorgen|goedemiddag|lieve)\b/i.test(p) && p.length < 60;
  const isClosing = (p) => /^(met )?(vriendelijke|hartelijke|warme|sportieve)?\s*(groet|groeten)\b/i.test(p) && p.length < 80;
  const isSignature = (p) => /^(white vision|het (white vision )?team)\W*$/i.test(p);
  while (paras.length > 1 && isOpening(paras[0])) paras.shift();
  while (paras.length > 1 && (isClosing(paras[paras.length - 1]) || isSignature(paras[paras.length - 1]))) paras.pop();
  return paras.join('\n\n');
}

async function writeIntro(data, ranges, googleAds) {
  const settings = ai.readSettings();
  try {
    const text = await ai.generateText(
      settings,
      SYSTEM_PROMPT,
      'Cijfers als JSON:\n' + JSON.stringify(buildPromptData(data, ranges, googleAds), null, 2)
    );
    return { text: stripGreetings(cleanText(text)), ai: true };
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

    const fontDir = path.join(__dirname, 'fonts');
    doc.registerFont('Body', path.join(fontDir, 'DMSans-Regular.woff'));
    doc.registerFont('BodyBold', path.join(fontDir, 'DMSans-Bold.woff'));
    doc.registerFont('Heading', path.join(fontDir, 'CormorantGaramond-Bold.woff'));

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensureSpace = (h) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    // Header: logo, 20pt gap, then brand name + tagline
    const LOGO_H = 52;
    const LOGO_W = LOGO_H * (1880 / 1960);
    const LOGO_GAP = 20;
    const logoPath = path.join(__dirname, 'public', 'logo-print.png');
    if (fs.existsSync(logoPath)) doc.image(logoPath, left, 38, { height: LOGO_H });
    const textX = left + LOGO_W + LOGO_GAP;
    doc.font('Heading').fontSize(28).fillColor(INK).text('White Vision', textX, 41, { lineBreak: false });
    doc.font('Body').fontSize(8).fillColor(GOLD)
      .text('UNIEK. STIJLVOL. ONVERGETELIJK.', textX, 73, { characterSpacing: 1.5, lineBreak: false });
    doc.moveTo(left, 100).lineTo(left + width, 100).strokeColor(LINE).lineWidth(0.5).stroke();

    doc.font('Heading').fontSize(22).fillColor(INK).text('Weekrapport Analytics', left, 114, { lineBreak: false });
    doc.font('Body').fontSize(9).fillColor(MUTED).text(
      'Periode: ' + nlDate(ranges.current.start, true) + ' t/m ' + nlDate(ranges.current.end, true) +
        ' (vorige week)  |  Vergeleken met de week ervoor',
      left, 142, { lineBreak: false }
    );
    doc.y = 166;

    const heading = (text) => {
      ensureSpace(90);
      doc.moveDown(0.9);
      doc.font('Heading').fontSize(15).fillColor(INK).text(text, left, doc.y);
      doc.moveDown(0.5);
    };

    // Intro
    intro.text.split(/\n{2,}|\n/).filter(Boolean).forEach((para) => {
      doc.font('Body').fontSize(10.5).fillColor(INK).text(para, left, doc.y, { width, lineGap: 3 });
      doc.moveDown(0.6);
    });

    // KPI widgets (same look as the dashboard tiles)
    const TILE_BG = '#f4f2ed';
    const UP = '#2e7d32';
    const DOWN = '#c62828';
    const GAP = 10;
    const TILE_H = 66;
    const tiles = (items, cols) => {
      const tileW = (width - GAP * (cols - 1)) / cols;
      for (let i = 0; i < items.length; i += cols) {
        ensureSpace(TILE_H + GAP);
        const y = doc.y;
        items.slice(i, i + cols).forEach((item, j) => {
          const x = left + j * (tileW + GAP);
          const color = item.change > 0 ? UP : item.change < 0 ? DOWN : MUTED;
          doc.roundedRect(x, y, tileW, TILE_H, 6).fill(TILE_BG);
          doc.font('Body').fontSize(7.5).fillColor(MUTED)
            .text(item.label.toUpperCase(), x + 10, y + 10, { width: tileW - 20, characterSpacing: 0.4, lineBreak: false });
          doc.font('BodyBold').fontSize(18).fillColor(INK);
          const value = item.fmt(item.current);
          const valueW = doc.widthOfString(value);
          doc.text(value, x + 10, y + 23, { lineBreak: false });
          const prev = '(' + item.fmt(item.previous) + ')';
          doc.font('Body').fontSize(9);
          if (10 + valueW + 5 + doc.widthOfString(prev) <= tileW - 8) {
            doc.fillColor(color).text(prev, x + 10 + valueW + 5, y + 30, { lineBreak: false });
          }
          doc.font('Body').fontSize(8).fillColor(color)
            .text(fmtChange(item.change) + ' vs vorige week', x + 10, y + 50, { width: tileW - 20, lineBreak: false });
        });
        doc.y = y + TILE_H + GAP;
      }
    };
    const k = data.kpis;
    const tile = (label, key, fmt) => ({ label, fmt, current: k[key].current, previous: k[key].previous, change: k[key].change });

    heading('Kerncijfers');
    tiles([
      tile('Sessies', 'sessions', fmtNum),
      tile('Gebruikers', 'users', fmtNum),
      tile('Paginaweergaven', 'pageviews', fmtNum),
      tile('Offerteaanvragen', 'offertes', fmtNum),
    ], 4);

    heading('Verkeer per bron');
    tiles([
      tile('Via Paid Ads', 'paidAds', fmtNum),
      tile('Via Social', 'social', fmtNum),
      tile('Via Search', 'search', fmtNum),
      tile('Overig', 'overig', fmtNum),
    ], 4);

    heading('Conversie');
    tiles([
      tile('Totaal gebruikers', 'conversionTotal', fmtPct),
      tile('Betaalde bezoekers', 'conversionPaid', fmtPct),
      tile('Socials', 'conversionSocial', fmtPct),
    ], 3);

    // Simple table: columns = [{ label, width, align }]
    const table = (columns, rows) => {
      const rowH = 20;
      const drawRow = (cells, header) => {
        ensureSpace(rowH);
        const y = doc.y;
        let x = left;
        doc.font(header ? 'BodyBold' : 'Body').fontSize(header ? 8 : 10);
        cells.forEach((cell, i) => {
          const col = columns[i];
          doc.fillColor(header ? MUTED : INK)
            .text(header ? String(cell).toUpperCase() : String(cell), x + 4, y + 5, {
              width: col.width - 8, align: col.align || 'left', lineBreak: false, ellipsis: true,
              characterSpacing: header ? 0.4 : 0,
            });
          x += col.width;
        });
        doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.y = y + rowH;
      };
      drawRow(columns.map((c) => c.label), true);
      if (!rows.length) drawRow(['Geen gegevens in deze periode'].concat(columns.slice(1).map(() => '')), false);
      rows.forEach((r) => drawRow(r, false));
    };

    // Daily sessions bar chart, inside a card
    heading('Sessies per dag');
    const days = data.dailySessions;
    const prevDays = data.dailySessionsPrev;
    const chartH = 110;
    const cardH = chartH + 74;
    ensureSpace(cardH);
    const cardTop = doc.y;
    doc.roundedRect(left, cardTop, width, cardH, 6).fill(TILE_BG);
    const chartTop = cardTop + 30;
    const innerLeft = left + 14;
    const innerW = width - 28;
    const max = Math.max(1, ...days.map((d) => d.sessions), ...prevDays.map((d) => d.sessions));
    const slot = innerW / days.length;
    const barW = Math.min(20, slot / 2 - 4);
    days.forEach((d, i) => {
      const cx = innerLeft + slot * i + slot / 2;
      const h = (d.sessions / max) * chartH;
      const ph = ((prevDays[i] ? prevDays[i].sessions : 0) / max) * chartH;
      doc.rect(cx - barW - 1, chartTop + chartH - ph, barW, ph).fill('#d9d5cb');
      doc.rect(cx + 1, chartTop + chartH - h, barW, h).fill(GOLD);
      doc.font('BodyBold').fontSize(8).fillColor(INK)
        .text(String(d.sessions), cx - slot / 2, chartTop + chartH - h - 11, { width: slot, align: 'center', lineBreak: false });
      doc.font('Body').fillColor(MUTED)
        .text(nlWeekday(d.date), cx - slot / 2, chartTop + chartH + 6, { width: slot, align: 'center', lineBreak: false });
    });
    const legendY = cardTop + cardH - 22;
    doc.rect(innerLeft, legendY + 1, 8, 8).fill(GOLD);
    doc.font('Body').fontSize(8).fillColor(MUTED).text('Deze week', innerLeft + 12, legendY, { lineBreak: false });
    doc.rect(innerLeft + 80, legendY + 1, 8, 8).fill('#d9d5cb');
    doc.fillColor(MUTED).text('Vorige week', innerLeft + 92, legendY, { lineBreak: false });
    doc.y = cardTop + cardH + GAP;

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
    doc.font('Body').fontSize(8).fillColor(MUTED).text(
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

module.exports = { createWeeklyReport, lastWeekRanges, amsterdamNow, mondayOf, shiftDate, cleanText, stripGreetings };
