// Weekly and monthly "actiepunten" report: an AI-written, prioritized list of
// concrete next steps based on the same analytics data as the site reports.
// This one is never published in the dashboard — it's mailed straight to
// Bojan (see mailer.js).
const ai = require('./ai');
const mailer = require('./mailer');
const { nlDate } = require('./lib/dates');
const { cleanText, stripGreetings } = require('./lib/text');
const { buildPromptData } = require('./lib/prompt-data');
const { fmtNum, fmtPct, fmtChange } = require('./report-pdf');

const SYSTEM_PROMPT =
  'Je schrijft een intern actiepunten-rapport voor Bojan, de beheerder van het White Vision dashboard. ' +
  'Op basis van de aangeleverde webstatistieken geef je een lijst van 4 tot 8 concrete, prioriteitsgestuurde actiepunten: ' +
  'wat zou jij deze periode oppakken om de resultaten te verbeteren? Onderbouw elk punt kort met het cijfer waarop het is gebaseerd. ' +
  'Gebruik alleen de aangeleverde cijfers en verzin niets. Noem geen oorzaken die je niet uit de data kunt afleiden; ' +
  'formuleer die dan als mogelijke verklaring. Schrijf in het Nederlands, informeel (je-vorm), direct en praktisch. ' +
  'Formaat: een genummerde lijst (1. 2. 3. ...), één actiepunt per regel van 1 tot 2 zinnen, geen inleiding, geen afsluiting, geen markdown-opmaak.';

function parseNumberedList(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

// Deterministic fallback when the AI is unavailable: flags the biggest movers.
function fallbackActionItems(data) {
  const k = data.kpis;
  const items = [];
  const note = (label, kpi) => {
    if (kpi.change <= -10) {
      items.push('Bekijk waarom "' + label + '" met ' + Math.abs(kpi.change) + '% daalde (' + kpi.previous + ' → ' + kpi.current + ').');
    } else if (kpi.change >= 20) {
      items.push('"' + label + '" steeg met ' + kpi.change + '% (' + kpi.previous + ' → ' + kpi.current + '); kijk of dit te herhalen of te versterken is.');
    }
  };
  note('Sessies', k.sessions);
  note('Offerteaanvragen', k.offertes);
  note('Conversie totaal', k.conversionTotal);
  note('Bezoekers via Paid Ads', k.paidAds);
  note('Bezoekers via Social', k.social);
  if (!items.length) items.push('Geen grote uitschieters deze periode; de cijfers liggen in lijn met de vorige periode.');
  return items;
}

async function generateActionItems(data, ranges, googleAds) {
  const settings = ai.readSettings();
  try {
    const text = await ai.generateText(
      settings,
      SYSTEM_PROMPT,
      'Cijfers als JSON:\n' + JSON.stringify(buildPromptData(data, ranges, googleAds), null, 2)
    );
    const items = parseNumberedList(stripGreetings(cleanText(text)));
    if (!items.length) throw new Error('Leeg antwoord');
    return { items, ai: true };
  } catch (err) {
    console.error('Action items AI generation failed, using fallback:', err.message);
    return { items: fallbackActionItems(data), ai: false, error: err.message };
  }
}

function kpiRow(label, kpi, fmt) {
  const color = kpi.change > 0 ? '#2e7d32' : kpi.change < 0 ? '#c62828' : '#666666';
  return (
    '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">' + label + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">' + fmt(kpi.current) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:' + color + '">' + fmtChange(kpi.change) + '</td></tr>'
  );
}

function buildHtml(kind, data, ranges, result) {
  const k = data.kpis;
  const periodLabel = nlDate(ranges.current.start, true) + ' t/m ' + nlDate(ranges.current.end, true);
  const itemsHtml = result.items.map((item) => '<li style="margin-bottom:8px">' + item + '</li>').join('');
  return (
    '<div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:600px">' +
    '<h2 style="color:#a8894b;margin-bottom:4px">Actiepunten ' + (kind === 'month' ? 'maandrapport' : 'weekrapport') + '</h2>' +
    '<p style="color:#666666;margin-top:0">Periode: ' + periodLabel + '</p>' +
    '<ol style="padding-left:20px">' + itemsHtml + '</ol>' +
    '<h3>Kerncijfers</h3>' +
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
    '<tr style="color:#666666;text-align:left">' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc">Metric</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right">Waarde</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid #ccc;text-align:right">Verandering</th></tr>' +
    kpiRow('Sessies', k.sessions, fmtNum) +
    kpiRow('Offerteaanvragen', k.offertes, fmtNum) +
    kpiRow('Conversie totaal', k.conversionTotal, fmtPct) +
    kpiRow('Bezoekers via Paid Ads', k.paidAds, fmtNum) +
    kpiRow('Bezoekers via Social', k.social, fmtNum) +
    '</table>' +
    (result.ai ? '' : '<p style="color:#c62828;font-size:12px">Let op: AI-analyse mislukt, dit is een automatisch gegenereerde standaardlijst.</p>') +
    '<p style="color:#999999;font-size:11px">Dit rapport wordt alleen gemaild, niet op het dashboard gepubliceerd.</p>' +
    '</div>'
  );
}

// kind is 'week' or 'month'.
async function sendActionItems({ kind, data, ranges, googleAds }) {
  const result = await generateActionItems(data, ranges, googleAds);
  const subject = 'Actiepunten ' + (kind === 'month' ? 'maandrapport' : 'weekrapport') + ' White Vision – ' + ranges.current.start + ' t/m ' + ranges.current.end;
  await mailer.sendMail({
    subject,
    html: buildHtml(kind, data, ranges, result),
    text: result.items.map((item, i) => (i + 1) + '. ' + item).join('\n'),
  });
  return result;
}

module.exports = { sendActionItems, generateActionItems };
