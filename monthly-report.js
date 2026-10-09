const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const { amsterdamNow, shiftDate, addMonths, firstOfMonth, mondayOf, nlDate } = require('./lib/dates');
const { writeIntro } = require('./intro');
const { renderReportPdf, fmtNum } = require('./report-pdf');
const { sendActionItems } = require('./actions-report');
const { sendReportPdf } = require('./report-mail');

const STATE_FILE = path.join(__dirname, 'data', 'monthly-report-state.json');
const RUN_AFTER_HOUR = 8; // Amsterdam time, on the 1st of the month
const RETRY_AFTER_MS = 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

// The last complete calendar month, plus the month before it for comparison.
function lastMonthRanges(now) {
  const firstOfThisMonth = firstOfMonth(amsterdamNow(now).date);
  const firstOfLastMonth = addMonths(firstOfThisMonth, -1);
  const firstOfMonthBefore = addMonths(firstOfLastMonth, -1);
  return {
    monthKey: firstOfLastMonth.slice(0, 7),
    current: { start: firstOfLastMonth, end: shiftDate(firstOfThisMonth, -1) },
    previous: { start: firstOfMonthBefore, end: shiftDate(firstOfLastMonth, -1) },
  };
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

// The monthly report is meant to be more extensive than the weekly one: it
// adds a per-week breakdown of the month plus the pages that drew the most
// traffic.
function monthlyExtras(ctx, data) {
  const { heading, table, width, fmtNum: fmt } = ctx;

  const weekTotals = new Map();
  data.dailySessions.forEach((d) => {
    const monday = mondayOf(d.date);
    weekTotals.set(monday, (weekTotals.get(monday) || 0) + d.sessions);
  });
  const weekRows = Array.from(weekTotals.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  heading('Sessies per week');
  table(
    [
      { label: 'Week van', width: width - 150 },
      { label: 'Sessies', width: 150, align: 'right' },
    ],
    weekRows.map(([monday, sessions]) => ['Week van ' + nlDate(monday, false), fmt(sessions)])
  );

  heading("Populairste pagina's");
  table(
    [
      { label: 'Pagina', width: width - 150 },
      { label: 'Paginaweergaven', width: 150, align: 'right' },
    ],
    (data.topPages || []).slice(0, 10).map((p) => [p.page, fmt(p.pageviews)])
  );
}

const PDF_OPTS = {
  docTitle: 'White Vision maandrapport',
  title: 'Maandrapport Analytics',
  periodNote: '(vorige maand)',
  compareNote: 'Vergeleken met de maand ervoor',
  compareShort: 'vs vorige maand',
  currentLabel: 'Deze maand',
  previousLabel: 'Vorige maand',
  xLabelFn: (dateStr) => String(new Date(dateStr + 'T12:00:00Z').getUTCDate()),
  showBarValues: false, // up to 31 bars — per-bar counts would overlap
  extra: monthlyExtras,
};

// --- Orchestration ---

function createMonthlyReport({ buildAnalytics, readGoogleAds, saveReport }) {
  let running = false;

  async function fetchData(ranges) {
    return buildAnalytics({ current: ranges.current, previous: ranges.previous }, 'custom', 'previous');
  }

  // Returns the buffer as well, so callers can also mail the PDF.
  async function generateSitePdf(data, ranges) {
    const intro = await writeIntro('month', data, ranges, await readGoogleAds(ranges.current));
    const buffer = await renderReportPdf(data, ranges, intro, PDF_OPTS);
    const filename = 'Maandrapport ' + ranges.current.start + ' t-m ' + ranges.current.end + '.pdf';
    const entry = saveReport(buffer, filename);
    return { entry, buffer, filename, aiUsed: intro.ai, aiError: intro.error };
  }

  async function generate(now) {
    if (running) throw new Error('Er wordt al een maandrapport gemaakt');
    running = true;
    try {
      const ranges = lastMonthRanges(now || new Date());
      const data = await fetchData(ranges);
      const result = await generateSitePdf(data, ranges);
      return { monthKey: ranges.monthKey, entry: result.entry, aiUsed: result.aiUsed, aiError: result.aiError };
    } finally {
      running = false;
    }
  }

  // Manual "mail het rapport nu" trigger: fresh data, and the PDF is both
  // saved in the Rapporten tab and mailed to the admin recipient.
  async function sendPdf(now) {
    if (running) throw new Error('Er wordt al een maandrapport gemaakt');
    running = true;
    try {
      const ranges = lastMonthRanges(now || new Date());
      const data = await fetchData(ranges);
      const result = await generateSitePdf(data, ranges);
      const mailed = await sendReportPdf({
        kind: 'month',
        data,
        ranges,
        buffer: result.buffer,
        filename: result.filename,
        aiUsed: result.aiUsed,
      });
      return {
        monthKey: ranges.monthKey,
        entry: result.entry,
        to: mailed.to,
        aiUsed: result.aiUsed,
        aiError: result.aiError,
      };
    } finally {
      running = false;
    }
  }

  // Manual "mail actiepunten nu" trigger — always fetches fresh data.
  async function sendActions(now) {
    const ranges = lastMonthRanges(now || new Date());
    const data = await fetchData(ranges);
    return Object.assign({ monthKey: ranges.monthKey }, await sendActionItems({ kind: 'month', data, ranges, googleAds: await readGoogleAds(ranges.current) }));
  }

  async function tick() {
    const settings = ai.readSettings();
    if (!settings.monthlyReportEnabled && !settings.monthlyActionsEnabled) return;

    const now = new Date();
    const local = amsterdamNow(now);
    if (local.date.slice(8, 10) !== '01' || local.hour < RUN_AFTER_HOUR) return;

    const monthKey = firstOfMonth(local.date).slice(0, 7);
    const state = readState();
    const reportDone = !settings.monthlyReportEnabled || state.lastMonth === monthKey;
    const actionsDone = !settings.monthlyActionsEnabled || state.lastMonthActions === monthKey;
    if (reportDone && actionsDone) return;
    if (state.lastAttemptAt && now - new Date(state.lastAttemptAt) < RETRY_AFTER_MS) return;

    const next = Object.assign({}, state, { lastAttemptAt: now.toISOString() });
    writeState(next);

    let ranges, data;
    try {
      ranges = lastMonthRanges(now);
      data = await fetchData(ranges);
    } catch (err) {
      console.error('Monthly report data fetch failed:', err.message);
      return;
    }

    if (!reportDone) {
      try {
        const result = await generateSitePdf(data, ranges);
        next.lastMonth = monthKey;
        next.lastReportId = result.entry.id;
        console.log('Monthly report generated for month ' + monthKey + (result.aiUsed ? '' : ' (without AI intro)'));
      } catch (err) {
        console.error('Monthly report failed:', err.message);
      }
    }

    if (!actionsDone) {
      try {
        await sendActionItems({ kind: 'month', data, ranges, googleAds: await readGoogleAds(ranges.current) });
        next.lastMonthActions = monthKey;
        console.log('Monthly action items emailed for month ' + monthKey);
      } catch (err) {
        console.error('Monthly action items email failed:', err.message);
      }
    }

    writeState(next);
  }

  function start() {
    setInterval(tick, TICK_MS);
    setTimeout(tick, 20000);
  }

  return { generate, sendActions, sendPdf, start };
}

module.exports = { createMonthlyReport, lastMonthRanges };
