// PDF layout shared by the weekly and monthly site reports (the ones that
// end up in the dashboard's Rapporten tab). Callers pass the period-specific
// wording (title, comparison labels, x-axis labels) via `opts`, and may
// supply `opts.extra(ctx, data, ranges)` to append extra sections — the
// monthly report uses this for its weekly-breakdown and top-pages tables.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { nlDate } = require('./lib/dates');

const GOLD = '#a8894b';
const INK = '#1a1a1a';
const MUTED = '#666666';
const LINE = '#dddddd';
const TILE_BG = '#f4f2ed';
const UP = '#2e7d32';
const DOWN = '#c62828';

const fmtNum = (n) => new Intl.NumberFormat('nl-NL').format(n);
const fmtDec1 = (n) => n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n) => n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const fmtChange = (c) => (c > 0 ? '+' : '') + c + '%';
const fmtDuration = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// opts: {
//   docTitle, title, periodNote, compareNote, compareShort,
//   currentLabel, previousLabel, xLabelFn(dateStr), showBarValues,
//   extra(ctx, data, ranges),
// }
function renderReportPdf(data, ranges, intro, opts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: opts.docTitle, Author: 'White Vision Dashboard' } });
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

    doc.font('Heading').fontSize(22).fillColor(INK).text(opts.title, left, 114, { lineBreak: false });
    doc.font('Body').fontSize(9).fillColor(MUTED).text(
      'Periode: ' + nlDate(ranges.current.start, true) + ' t/m ' + nlDate(ranges.current.end, true) +
        ' ' + opts.periodNote + '  |  ' + opts.compareNote,
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
    const GAP = 10;
    const TILE_H = 66;
    const tiles = (items, cols) => {
      const tileW = (width - GAP * (cols - 1)) / cols;
      for (let i = 0; i < items.length; i += cols) {
        ensureSpace(TILE_H + GAP);
        const y = doc.y;
        items.slice(i, i + cols).forEach((item, j) => {
          const x = left + j * (tileW + GAP);
          const color = item.change === 0 ? MUTED : item.change > 0 ? (item.invert ? DOWN : UP) : (item.invert ? UP : DOWN);
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
            .text(fmtChange(item.change) + ' ' + opts.compareShort, x + 10, y + 50, { width: tileW - 20, lineBreak: false });
        });
        doc.y = y + TILE_H + GAP;
      }
    };
    const k = data.kpis;
    const tile = (label, key, fmt, invert) => ({ label, fmt, invert, current: k[key].current, previous: k[key].previous, change: k[key].change });

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

    heading('Engagement');
    tiles([
      tile('Tijd per bezoek', 'avgSessionDuration', fmtDuration),
      tile("Pagina's per bezoek", 'pagesPerSession', fmtDec1),
      tile('Engagementpercentage', 'engagementRate', fmtPct),
      tile('Bouncepercentage', 'bounceRate', fmtPct, true),
    ], 4);

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
      if (opts.showBarValues) {
        doc.font('BodyBold').fontSize(8).fillColor(INK)
          .text(String(d.sessions), cx - slot / 2, chartTop + chartH - h - 11, { width: slot, align: 'center', lineBreak: false });
      }
      doc.font('Body').fillColor(MUTED)
        .text(opts.xLabelFn(d.date), cx - slot / 2, chartTop + chartH + 6, { width: slot, align: 'center', lineBreak: false });
    });
    const legendY = cardTop + cardH - 22;
    doc.rect(innerLeft, legendY + 1, 8, 8).fill(GOLD);
    doc.font('Body').fontSize(8).fillColor(MUTED).text(opts.currentLabel, innerLeft + 12, legendY, { lineBreak: false });
    doc.rect(innerLeft + 80, legendY + 1, 8, 8).fill('#d9d5cb');
    doc.fillColor(MUTED).text(opts.previousLabel, innerLeft + 92, legendY, { lineBreak: false });
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

    if (typeof opts.extra === 'function') {
      opts.extra({ doc, left, width, heading, table, ensureSpace, fmtNum, fmtPct }, data, ranges);
    }

    // Footer note
    doc.moveDown(1.5);
    ensureSpace(30);
    doc.font('Body').fontSize(8).fillColor(MUTED).text(
      'Bron: Google Analytics 4. ' + (intro.ai ? 'De inleiding is geschreven met behulp van AI.' : '') +
      ' Gegenereerd op ' + new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }) + '.',
      left, doc.y, { width }
    );

    doc.end();
  });
}

module.exports = { renderReportPdf, fmtNum, fmtDec1, fmtPct, fmtChange, fmtDuration };
