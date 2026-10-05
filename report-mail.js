// Emails a generated site report (the week- or maandrapport PDF) as an
// attachment to the admin recipient configured under "Ontvanger actiepunten"
// on the E-mail (SMTP) tab. Unlike actions-report.js, which mails a short HTML
// to-do list, this one carries the PDF itself: the mail body is just a summary
// so the attachment is readable at a glance on a phone.
const mailer = require('./mailer');
const { nlDate } = require('./lib/dates');
const { fmtNum, fmtPct, fmtChange, fmtDuration, fmtDec1 } = require('./report-pdf');

const KIND_LABEL = { week: 'Weekrapport', month: 'Maandrapport' };
const COMPARE_LABEL = { week: 'vorige week', month: 'vorige maand' };

const SOCIALS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn']];

function kpiRow(label, kpi, fmt, compare, invert) {
  const color = kpi.change === 0 ? '#666666' : (invert ? kpi.change < 0 : kpi.change > 0) ? '#2e7d32' : '#c62828';
  return (
    '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">' + label + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">' + fmt(kpi.current) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#999999">' + fmt(kpi.previous) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:' + color + '">' + fmtChange(kpi.change) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;color:#999999;font-size:11px;text-align:right">' + compare + '</td>' +
    '</tr>'
  );
}

function buildHtml(kind, data, ranges, opts) {
  const k = data.kpis;
  const compare = COMPARE_LABEL[kind] || COMPARE_LABEL.week;
  const periodLabel = nlDate(ranges.current.start, true) + ' t/m ' + nlDate(ranges.current.end, true);
  return (
    '<div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:600px">' +
    '<h2 style="color:#a8894b;margin-bottom:4px">' + KIND_LABEL[kind] + ' Analytics</h2>' +
    '<p style="color:#666666;margin-top:0">Periode: ' + periodLabel + ' — vergeleken met de ' + compare + '</p>' +
    '<p style="color:#1a1a1a">Het volledige rapport staat als PDF-bijlage bij deze mail.</p>' +
    '<h3>Kerncijfers</h3>' +
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
    '<tr style="color:#666666;text-align:left">' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc">Metric</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right">Waarde</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right">' + compare + '</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right">Verandering</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right"></th>' +
    '</tr>' +
    kpiRow('Sessies', k.sessions, fmtNum, compare) +
    kpiRow('Gebruikers', k.users, fmtNum, compare) +
    kpiRow('Paginaweergaven', k.pageviews, fmtNum, compare) +
    kpiRow('Offerteaanvragen', k.offertes, fmtNum, compare) +
    kpiRow('Conversie totaal', k.conversionTotal, fmtPct, compare) +
    kpiRow('Conversie betaalde bezoekers', k.conversionPaid, fmtPct, compare) +
    SOCIALS.map(([key, label]) => kpiRow('Conversie ' + label, data.socialPlatforms[key].conversion, fmtPct, compare)).join('') +
    kpiRow('Bezoekers via Paid Ads', k.paidAds, fmtNum, compare) +
    kpiRow('Bezoekers via Social', k.social, fmtNum, compare) +
    kpiRow('Gemiddelde bezoekduur', k.avgSessionDuration, fmtDuration, compare) +
    kpiRow("Pagina's per bezoek", k.pagesPerSession, fmtDec1, compare) +
    kpiRow('Engagementpercentage', k.engagementRate, fmtPct, compare) +
    kpiRow('Bouncepercentage', k.bounceRate, fmtPct, compare, true) +
    '</table>' +
    (opts.aiUsed ? '' : '<p style="color:#c62828;font-size:12px">Let op: de AI-inleiding in de PDF is mislukt, daarvoor is standaardtekst gebruikt.</p>') +
    '<p style="color:#999999;font-size:11px">Dit rapport is ook toegevoegd aan het tabblad Rapporten van het White Vision dashboard.</p>' +
    '</div>'
  );
}

function buildText(kind, data, ranges, opts) {
  const k = data.kpis;
  const compare = COMPARE_LABEL[kind] || COMPARE_LABEL.week;
  const lines = [
    KIND_LABEL[kind] + ' Analytics',
    'Periode: ' + nlDate(ranges.current.start, true) + ' t/m ' + nlDate(ranges.current.end, true) +
      ' — vergeleken met de ' + compare,
    '',
    'Het volledige rapport staat als PDF-bijlage bij deze mail.',
    '',
    'Kerncijfers (waarde, ' + compare + ', verandering):',
    '  Sessies:              ' + fmtNum(k.sessions.current) + ' (' + fmtNum(k.sessions.previous) + ', ' + fmtChange(k.sessions.change) + ')',
    '  Gebruikers:           ' + fmtNum(k.users.current) + ' (' + fmtNum(k.users.previous) + ', ' + fmtChange(k.users.change) + ')',
    '  Paginaweergaven:      ' + fmtNum(k.pageviews.current) + ' (' + fmtNum(k.pageviews.previous) + ', ' + fmtChange(k.pageviews.change) + ')',
    '  Offerteaanvragen:     ' + fmtNum(k.offertes.current) + ' (' + fmtNum(k.offertes.previous) + ', ' + fmtChange(k.offertes.change) + ')',
    '  Conversie totaal:     ' + fmtPct(k.conversionTotal.current) + ' (' + fmtPct(k.conversionTotal.previous) + ', ' + fmtChange(k.conversionTotal.change) + ')',
    '  Conversie betaald:    ' + fmtPct(k.conversionPaid.current) + ' (' + fmtPct(k.conversionPaid.previous) + ', ' + fmtChange(k.conversionPaid.change) + ')',
    ...SOCIALS.map(([key, label]) => {
      const c = data.socialPlatforms[key].conversion;
      return ('  Conversie ' + label + ':').padEnd(24) + fmtPct(c.current) + ' (' + fmtPct(c.previous) + ', ' + fmtChange(c.change) + ')';
    }),
    '  Bezoekers Paid Ads:   ' + fmtNum(k.paidAds.current) + ' (' + fmtNum(k.paidAds.previous) + ', ' + fmtChange(k.paidAds.change) + ')',
    '  Bezoekers Social:     ' + fmtNum(k.social.current) + ' (' + fmtNum(k.social.previous) + ', ' + fmtChange(k.social.change) + ')',
    '  Gemiddelde bezoekduur:' + fmtDuration(k.avgSessionDuration.current) + ' (' + fmtDuration(k.avgSessionDuration.previous) + ', ' + fmtChange(k.avgSessionDuration.change) + ')',
    "  Pagina's per bezoek:  " + fmtDec1(k.pagesPerSession.current) + ' (' + fmtDec1(k.pagesPerSession.previous) + ', ' + fmtChange(k.pagesPerSession.change) + ')',
    '  Engagementpercentage: ' + fmtPct(k.engagementRate.current) + ' (' + fmtPct(k.engagementRate.previous) + ', ' + fmtChange(k.engagementRate.change) + ')',
    '  Bouncepercentage:     ' + fmtPct(k.bounceRate.current) + ' (' + fmtPct(k.bounceRate.previous) + ', ' + fmtChange(k.bounceRate.change) + ')',
  ];
  if (!opts.aiUsed) {
    lines.push('', 'Let op: de AI-inleiding in de PDF is mislukt, daarvoor is standaardtekst gebruikt.');
  }
  lines.push('', 'Dit rapport is ook toegevoegd aan het tabblad Rapporten van het White Vision dashboard.');
  return lines.join('\n');
}

// kind is 'week' or 'month'. `buffer` is the rendered PDF, `filename` the name
// it is also stored under in the Rapporten tab. Resolves to the recipient the
// mail went to, so the UI can confirm it.
async function sendReportPdf({ kind, data, ranges, buffer, filename, aiUsed }) {
  const subject = KIND_LABEL[kind] + ' White Vision – ' + ranges.current.start + ' t/m ' + ranges.current.end;
  const to = mailer.reportRecipient();
  await mailer.sendMail({
    subject,
    html: buildHtml(kind, data, ranges, { aiUsed }),
    text: buildText(kind, data, ranges, { aiUsed }),
    attachments: [{ filename, content: buffer }],
  });
  return { to };
}

module.exports = { sendReportPdf };
