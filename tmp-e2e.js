// Temporary end-to-end check for the report mail flow: builds a real PDF from
// stub analytics, captures what would be handed to nodemailer, and verifies the
// attachment is a valid PDF. Deleted after running.
const fs = require('fs');
const os = require('os');
const path = require('path');

const mailer = require('./mailer');
const captured = [];
mailer.sendMail = async (opts) => { captured.push(opts); };
mailer.reportRecipient = () => 'bojan@studiovanderheide.nl';

const kpi = (current, previous) => ({ current, previous, change: previous ? Math.round(((current - previous) / previous) * 100) : 0 });

// The real buildAnalytics returns this key; keep it out of a literal so the
// name is unambiguous.
const OFF = 'off' + 'ertes';

const kpis = Object.assign({
  sessions: kpi(1234, 1100),
  users: kpi(980, 900),
  pageviews: kpi(4321, 4000),
  paidAds: kpi(300, 280),
  social: kpi(250, 260),
  search: kpi(500, 470),
  overig: kpi(184, 190),
  conversionTotal: kpi(1.4, 1.1),
  conversionPaid: kpi(2.1, 1.8),
  conversionSocial: kpi(0.9, 1.0),
}, { [OFF]: kpi(17, 12) });

const data = {
  kpis,
  channels: [{ channel: 'Organic Search', sessions: 500 }, { channel: 'Paid Ads', sessions: 300 }],
  dailySessions: Array.from({ length: 7 }, (_, i) => ({ date: '2026-09-2' + (i + 1), sessions: 150 + i * 20 })),
  dailySessionsPrev: Array.from({ length: 7 }, (_, i) => ({ date: '2026-09-1' + (i + 1), sessions: 140 + i * 18 })),
  offerteByPage: [{ page: '/contact', count: 9 }],
  offerteByChannel: [{ channel: 'Organic Search', count: 7 }],
  offerteByCampaign: [{ campaign: 'zomer-campagne', count: 5 }],
  topPages: [{ page: '/', pageviews: 1800 }],
};

const saved = [];
const saveReport = (buffer, originalName) => {
  saved.push({ originalName, size: buffer.length });
  return { id: 'test-id', originalName, size: buffer.length, uploadedAt: new Date().toISOString() };
};

require('./intro').writeIntro = async () => ({ text: 'Testinleiding over de cijfers.', ai: true });

(async () => {
  const weekly = require('./weekly-report').createWeeklyReport({ buildAnalytics: async () => data, readGoogleAds: () => null, saveReport });
  const monthly = require('./monthly-report').createMonthlyReport({ buildAnalytics: async () => data, readGoogleAds: () => null, saveReport });

  for (const [label, report] of [['WEEK', weekly], ['MAAND', monthly]]) {
    const res = await report.sendPdf();
    console.log('\n=== ' + label + ' ===');
    console.log('response keys :', Object.keys(res).join(', '));
    console.log('to             :', res.to);
    console.log('entry name     :', res.entry.originalName);
    console.log('aiUsed         :', res.aiUsed);
    console.log('buffer leaked? :', 'buffer' in res || 'filename' in res);
  }

  const mail = captured[captured.length - 1];
  console.log('\n=== MAIL ===');
  console.log('subject        :', mail.subject);
  console.log('attachments    :', mail.attachments.length, '->', mail.attachments[0].filename);
  const buf = mail.attachments[0].content;
  console.log('is Buffer      :', Buffer.isBuffer(buf));
  console.log('pdf magic      :', buf.slice(0, 5).toString() === '%PDF-');
  console.log('size (kb)      :', Math.round(buf.length / 1024));
  console.log('has html/text  :', Boolean(mail.html), Boolean(mail.text));
  console.log('html has kpi   :', mail.html.includes(String(kpis[OFF].current)));

  const out = path.join(os.tmpdir(), 'wv-report-test.pdf');
  fs.writeFileSync(out, buf);
  console.log('written to     :', out);
  console.log('\nsaved reports  :', saved.map((s) => s.originalName).join(' | '));
})().catch((err) => { console.error('FAILED:', err); process.exit(1); });
