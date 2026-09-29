const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const { amsterdamNow, shiftDate, mondayOf, nlWeekday } = require('./lib/dates');
const { writeIntro } = require('./intro');
const { renderReportPdf } = require('./report-pdf');
const { sendActionItems } = require('./actions-report');
const { sendReportPdf } = require('./report-mail');

const STATE_FILE = path.join(__dirname, 'data', 'weekly-report-state.json');
const RUN_AFTER_HOUR = 7; // Amsterdam time, on Mondays
const RETRY_AFTER_MS = 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

// The last complete Monday-Sunday week, plus the week before it for comparison.
function lastWeekRanges(now) {
  const monday = mondayOf(amsterdamNow(now).date);
  return {
    weekKey: monday,
    current: { start: shiftDate(monday, -7), end: shiftDate(monday, -1) },
    previous: { start: shiftDate(monday, -14), end: shiftDate(monday, -8) },
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

const PDF_OPTS = {
  docTitle: 'White Vision weekrapport',
  title: 'Weekrapport Analytics',
  periodNote: '(vorige week)',
  compareNote: 'Vergeleken met de week ervoor',
  compareShort: 'vs vorige week',
  currentLabel: 'Deze week',
  previousLabel: 'Vorige week',
  xLabelFn: nlWeekday,
  showBarValues: true,
};

// --- Orchestration ---

function createWeeklyReport({ buildAnalytics, readGoogleAds, saveReport }) {
  let running = false;

  async function fetchData(ranges) {
    return buildAnalytics({ current: ranges.current, previous: ranges.previous }, 'custom', 'previous');
  }

  // Returns the buffer as well, so callers can also mail the PDF.
  async function generateSitePdf(data, ranges) {
    const intro = await writeIntro('week', data, ranges, readGoogleAds());
    const buffer = await renderReportPdf(data, ranges, intro, PDF_OPTS);
    const filename = 'Weekrapport ' + ranges.current.start + ' t-m ' + ranges.current.end + '.pdf';
    const entry = saveReport(buffer, filename);
    return { entry, buffer, filename, aiUsed: intro.ai, aiError: intro.error };
  }

  async function generate(now) {
    if (running) throw new Error('Er wordt al een weekrapport gemaakt');
    running = true;
    try {
      const ranges = lastWeekRanges(now || new Date());
      const data = await fetchData(ranges);
      const result = await generateSitePdf(data, ranges);
      return { weekKey: ranges.weekKey, entry: result.entry, aiUsed: result.aiUsed, aiError: result.aiError };
    } finally {
      running = false;
    }
  }

  // Manual "mail het rapport nu" trigger: fresh data, and the PDF is both
  // saved in the Rapporten tab and mailed to the admin recipient.
  async function sendPdf(now) {
    if (running) throw new Error('Er wordt al een weekrapport gemaakt');
    running = true;
    try {
      const ranges = lastWeekRanges(now || new Date());
      const data = await fetchData(ranges);
      const result = await generateSitePdf(data, ranges);
      const mailed = await sendReportPdf({
        kind: 'week',
        data,
        ranges,
        buffer: result.buffer,
        filename: result.filename,
        aiUsed: result.aiUsed,
      });
      return {
        weekKey: ranges.weekKey,
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
    const ranges = lastWeekRanges(now || new Date());
    const data = await fetchData(ranges);
    return Object.assign({ weekKey: ranges.weekKey }, await sendActionItems({ kind: 'week', data, ranges, googleAds: readGoogleAds() }));
  }

  async function tick() {
    const settings = ai.readSettings();
    if (!settings.weeklyReportEnabled && !settings.weeklyActionsEnabled) return;

    const now = new Date();
    const local = amsterdamNow(now);
    if (local.weekday !== 'Mon' || local.hour < RUN_AFTER_HOUR) return;

    const weekKey = mondayOf(local.date);
    const state = readState();
    const reportDone = !settings.weeklyReportEnabled || state.lastWeek === weekKey;
    const actionsDone = !settings.weeklyActionsEnabled || state.lastWeekActions === weekKey;
    if (reportDone && actionsDone) return;
    if (state.lastAttemptAt && now - new Date(state.lastAttemptAt) < RETRY_AFTER_MS) return;

    const next = Object.assign({}, state, { lastAttemptAt: now.toISOString() });
    writeState(next);

    let ranges, data;
    try {
      ranges = lastWeekRanges(now);
      data = await fetchData(ranges);
    } catch (err) {
      console.error('Weekly report data fetch failed:', err.message);
      return;
    }

    if (!reportDone) {
      try {
        const result = await generateSitePdf(data, ranges);
        next.lastWeek = weekKey;
        next.lastReportId = result.entry.id;
        console.log('Weekly report generated for week ' + weekKey + (result.aiUsed ? '' : ' (without AI intro)'));
      } catch (err) {
        console.error('Weekly report failed:', err.message);
      }
    }

    if (!actionsDone) {
      try {
        await sendActionItems({ kind: 'week', data, ranges, googleAds: readGoogleAds() });
        next.lastWeekActions = weekKey;
        console.log('Weekly action items emailed for week ' + weekKey);
      } catch (err) {
        console.error('Weekly action items email failed:', err.message);
      }
    }

    writeState(next);
  }

  function start() {
    setInterval(tick, TICK_MS);
    setTimeout(tick, 15000);
  }

  return { generate, sendActions, sendPdf, start };
}

module.exports = { createWeeklyReport, lastWeekRanges };
